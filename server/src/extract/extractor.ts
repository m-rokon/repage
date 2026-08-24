/**
 * Extraction Engine (plan §4.1)
 *
 * Loads the target URL in headless Chromium, waits for DOM stability,
 * then captures — inside the page —
 *   - the fully rendered DOM (post-JS) as a raw IR tree
 *   - only the CSS rules that actually match something in the DOM
 *     (raw CSS + cascade resolution, NOT computed-style dumps)
 *   - inline/external script inventory
 *
 * Cross-origin stylesheets (whose cssRules the page can't read) are fetched
 * server-side via Playwright's request API and re-injected as constructed
 * stylesheets so the same in-page used-rule filtering applies to them.
 */

import { chromium, type Browser } from 'playwright';
import type { RawCapture } from '../types.js';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
    browserPromise.then((b) => b.on('disconnected', () => (browserPromise = null)));
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* In-page functions. These are serialized by Playwright and executed  */
/* in the browser — they must be fully self-contained.                 */
/* ------------------------------------------------------------------ */

/** Returns hrefs of stylesheets whose rules the page cannot read (cross-origin). */
const collectInaccessibleSheets = () => {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      void sheet.cssRules;
    } catch {
      if (sheet.href) out.push(sheet.href);
    }
  }
  return out;
};

interface CapturePayload {
  extraCss: { href: string; text: string }[];
}

const capturePage = (args: CapturePayload) => {
  const warnings: string[] = [];

  /* ---------- CSS: keep only rules that match the live DOM ---------- */

  const rewriteUrls = (cssText: string, baseHref: string | null): string => {
    if (!baseHref) return cssText;
    return cssText.replace(
      /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g,
      (match, _q: string, u: string) => {
        if (/^(data:|blob:|#|https?:|\/\/)/i.test(u)) return match;
        try {
          return `url("${new URL(u, baseHref).href}")`;
        } catch {
          return match;
        }
      },
    );
  };

  const matchCache = new Map<string, boolean>();
  const anySelectorMatches = (selectorText: string): boolean => {
    const cached = matchCache.get(selectorText);
    if (cached !== undefined) return cached;
    const parts = selectorText.split(/,(?![^()]*\))/);
    let ok = false;
    for (let s of parts) {
      s = s.trim();
      if (!s) continue;
      try {
        if (document.querySelector(s)) {
          ok = true;
          break;
        }
      } catch {
        ok = true; // unparseable by querySelector — keep, don't guess
        break;
      }
      // strip pseudo-classes/elements and retry (":hover", "::before", ...)
      const stripped = s
        .replace(/::?[a-zA-Z-]+(\((?:[^()]|\([^()]*\))*\))?/g, '')
        .trim();
      if (stripped === s) continue;
      if (!stripped) {
        // selector was pure pseudo (":root", "*::before") — treat as matching
        ok = true;
        break;
      }
      try {
        if (document.querySelector(stripped)) {
          ok = true;
          break;
        }
      } catch {
        ok = true;
        break;
      }
    }
    matchCache.set(selectorText, ok);
    return ok;
  };

  const cssOut: string[] = [];

  const processRules = (
    rules: CSSRuleList | CSSRule[],
    sink: string[],
    baseHref: string | null,
  ): void => {
    for (const rule of Array.from(rules as CSSRule[])) {
      const kind = rule.constructor.name;
      try {
        if (kind === 'CSSStyleRule') {
          const styleRule = rule as CSSStyleRule;
          if (anySelectorMatches(styleRule.selectorText)) {
            sink.push(rewriteUrls(styleRule.cssText, baseHref));
          }
        } else if (kind === 'CSSMediaRule') {
          const mediaRule = rule as CSSMediaRule;
          if (mediaRule.media.mediaText.includes('print')) continue;
          const inner: string[] = [];
          processRules(mediaRule.cssRules, inner, baseHref);
          if (inner.length) {
            sink.push(`@media ${mediaRule.media.mediaText} {\n${inner.join('\n')}\n}`);
          }
        } else if (kind === 'CSSSupportsRule') {
          const supportsRule = rule as CSSSupportsRule;
          const inner: string[] = [];
          processRules(supportsRule.cssRules, inner, baseHref);
          if (inner.length) {
            sink.push(`@supports ${supportsRule.conditionText} {\n${inner.join('\n')}\n}`);
          }
        } else if (kind === 'CSSImportRule') {
          const importRule = rule as CSSImportRule;
          if (importRule.styleSheet) {
            try {
              processRules(
                importRule.styleSheet.cssRules,
                sink,
                importRule.styleSheet.href || baseHref,
              );
            } catch {
              if (importRule.href) warnings.push(`Could not read @import: ${importRule.href}`);
            }
          }
        } else if (kind === 'CSSLayerBlockRule') {
          // flatten @layer blocks — order approximation is acceptable for v1
          processRules((rule as unknown as { cssRules: CSSRuleList }).cssRules, sink, baseHref);
        } else if (kind === 'CSSFontFaceRule' || kind === 'CSSKeyframesRule' || kind === 'CSSPropertyRule') {
          // kept for now; unused ones are dropped in the server-side cleaning pass
          sink.push(rewriteUrls(rule.cssText, baseHref));
        }
      } catch {
        /* single bad rule shouldn't kill the capture */
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.media && sheet.media.mediaText && sheet.media.mediaText.includes('print')) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin — handled via extraCss below
    }
    processRules(rules, cssOut, sheet.href || document.baseURI);
  }

  for (const extra of args.extraCss) {
    try {
      const constructed = new CSSStyleSheet();
      constructed.replaceSync(extra.text);
      processRules(constructed.cssRules, cssOut, extra.href);
    } catch {
      warnings.push(`Could not parse stylesheet: ${extra.href}`);
    }
  }

  /* ---------- DOM tree ---------- */

  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'BASE']);

  interface RawNode {
    type: 'element' | 'text';
    tag?: string;
    attrs?: Record<string, string>;
    classes?: string[];
    text?: string;
    children?: RawNode[];
    meta?: { hidden?: boolean };
  }

  const absolutize = (value: string): string => {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  };

  const serializeNode = (node: Node): RawNode | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text || !text.trim()) return null;
      return { type: 'text', text: text.replace(/\s+/g, ' ') };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const tag = el.tagName.toLowerCase();
    const attrs: Record<string, string> = {};
    let classes: string[] = [];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (/^on/i.test(name)) continue; // inline event handler soup
      if (name === 'class') {
        classes = attr.value.split(/\s+/).filter(Boolean);
        continue;
      }
      attrs[name] = attr.value;
    }
    // absolutize URLs so output works outside the original origin
    if (attrs.src && !attrs.src.startsWith('data:')) attrs.src = absolutize(attrs.src);
    if (attrs.href) attrs.href = absolutize(attrs.href);
    if (attrs.poster) attrs.poster = absolutize(attrs.poster);
    if (attrs.srcset) {
      attrs.srcset = attrs.srcset
        .split(',')
        .map((part) => {
          const bits = part.trim().split(/\s+/);
          if (bits[0]) bits[0] = absolutize(bits[0]);
          return bits.join(' ');
        })
        .join(', ');
    }
    if (tag === 'img' && !attrs.src) {
      const cur = (el as HTMLImageElement).currentSrc;
      if (cur) attrs.src = cur;
    }

    const result: RawNode = { type: 'element', tag, attrs, classes, children: [] };

    let hidden = false;
    try {
      const style = window.getComputedStyle(el);
      hidden = style.display === 'none' || style.visibility === 'hidden';
    } catch {
      /* detached */
    }
    if (hidden) result.meta = { hidden: true };

    if (tag !== 'svg') {
      for (const child of Array.from(el.childNodes)) {
        const s = serializeNode(child);
        if (s) result.children!.push(s);
      }
    } else {
      // keep SVG markup verbatim — serializing every path node is noise
      result.attrs!['data-repage-svg'] = el.outerHTML;
      result.children = [];
    }
    return result;
  };

  const tree = document.body ? serializeNode(document.body) : null;

  /* ---------- scripts ---------- */

  const scripts: { src?: string; content?: string; scriptType?: string }[] = [];
  for (const s of Array.from(document.querySelectorAll('script'))) {
    const scriptType = s.getAttribute('type') || undefined;
    if (scriptType && /json/i.test(scriptType)) continue; // JSON-LD / data blobs
    if (s.src) scripts.push({ src: s.src, scriptType });
    else {
      const content = (s.textContent || '').trim();
      if (content) scripts.push({ content: content.slice(0, 40000), scriptType });
    }
  }

  return {
    title: document.title,
    tree,
    css: cssOut.join('\n'),
    scripts,
    warnings,
  };
};

const autoScroll = async () => {
  const step = window.innerHeight;
  const max = Math.min(document.body ? document.body.scrollHeight : 0, 20000);
  for (let y = 0; y < max; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 250));
};

/* ------------------------------------------------------------------ */

export interface ExtractOptions {
  onPhase?: (phase: 'fetching' | 'extracting') => void;
  timeoutMs?: number;
}

export async function extractPage(url: string, opts: ExtractOptions = {}): Promise<RawCapture> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: USER_AGENT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    // esbuild-based runners (tsx) inject __name() helper calls into serialized
    // functions; provide a no-op so page.evaluate works in dev and prod alike
    await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    opts.onPhase?.('fetching');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.evaluate(autoScroll).catch(() => {});

    opts.onPhase?.('extracting');
    const inaccessible = await page.evaluate(collectInaccessibleSheets);
    const extraCss: { href: string; text: string }[] = [];
    for (const href of inaccessible) {
      try {
        const res = await context.request.get(href, { timeout: 15000 });
        if (res.ok()) extraCss.push({ href, text: await res.text() });
      } catch {
        /* stylesheet fetch failed — capture continues without it */
      }
    }

    const capture = (await page.evaluate(capturePage, { extraCss })) as RawCapture;
    for (const href of inaccessible) {
      if (!extraCss.some((e) => e.href === href)) {
        capture.warnings.push(`Could not fetch cross-origin stylesheet: ${href}`);
      }
    }
    return capture;
  } finally {
    await context.close();
  }
}

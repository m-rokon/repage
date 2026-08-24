/**
 * CSS side of the cleaning pass (plan §4.2):
 *  - drop rules whose selectors can no longer match the cleaned IR
 *  - deduplicate identical rules
 *  - drop @keyframes / @font-face that nothing references
 *  - rename auto-generated class names consistently with the DOM
 *  - pretty-print (the capture already comes browser-normalized)
 */

import * as csstree from 'css-tree';

export interface CssUsage {
  classes: Set<string>;
  ids: Set<string>;
  tags: Set<string>;
}

const ALWAYS_OK_TAGS = new Set(['html', 'body', '*', 'root']);

/** Split "a, b" on top-level commas only (not inside parens/quotes). */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of input) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
      cur += ch;
    } else if (ch === ')' || ch === ']') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Can this single selector still match the cleaned DOM?
 * Only inspects the top-level compound chain — contents of :not()/:is()
 * are not descended into (kept optimistically).
 */
function selectorUsable(selector: csstree.CssNode, usage: CssUsage): boolean {
  let usable = true;
  const visit = (node: csstree.CssNode): void => {
    if (!usable) return;
    if (node.type === 'ClassSelector') {
      if (!usage.classes.has(node.name)) usable = false;
    } else if (node.type === 'IdSelector') {
      if (!usage.ids.has(node.name)) usable = false;
    } else if (node.type === 'TypeSelector') {
      const name = node.name.toLowerCase();
      if (!ALWAYS_OK_TAGS.has(name) && !usage.tags.has(name)) usable = false;
    } else if (node.type === 'Selector') {
      (node.children as csstree.List<csstree.CssNode>).forEach(visit);
    }
    // PseudoClassSelector / PseudoElementSelector / Combinator / AttributeSelector: skip
  };
  visit(selector);
  return usable;
}

function filterRulePrelude(rule: csstree.Rule, usage: CssUsage): boolean {
  if (rule.prelude.type !== 'SelectorList') return true; // Raw prelude — keep
  const list = rule.prelude.children as csstree.List<csstree.CssNode>;
  const kept: csstree.CssNode[] = [];
  list.forEach((sel) => {
    if (sel.type !== 'Selector' || selectorUsable(sel, usage)) kept.push(sel);
  });
  if (kept.length === 0) return false;
  rule.prelude.children = new csstree.List<csstree.CssNode>().fromArray(kept);
  return true;
}

/** Rename ClassSelector nodes throughout the AST according to the map. */
function renameClassesInAst(ast: csstree.CssNode, renameMap: Record<string, string>): void {
  csstree.walk(ast, (node) => {
    if (node.type === 'ClassSelector' && renameMap[node.name]) {
      node.name = renameMap[node.name];
    }
  });
}

function collectAnimationNames(ast: csstree.CssNode): Set<string> {
  const names = new Set<string>();
  csstree.walk(ast, (node) => {
    if (node.type === 'Declaration' && /^(-webkit-)?animation(-name)?$/.test(node.property)) {
      csstree.walk(node.value, (v) => {
        if (v.type === 'Identifier') names.add(v.name);
        if (v.type === 'String') names.add(v.value);
      });
    }
  });
  return names;
}

function collectFontFamilies(ast: csstree.CssNode): Set<string> {
  const fams = new Set<string>();
  csstree.walk(ast, {
    visit: 'Declaration',
    enter(node) {
      if (this.atrule && csstree.keyword(this.atrule.name).basename === 'font-face') return;
      if (!/^(font|font-family)$/.test(node.property)) return;
      csstree.walk(node.value, (v) => {
        if (v.type === 'Identifier') fams.add(v.name.toLowerCase());
        if (v.type === 'String') fams.add(v.value.toLowerCase());
      });
    },
  });
  return fams;
}

function fontFaceFamily(atrule: csstree.Atrule): string | null {
  let fam: string | null = null;
  csstree.walk(atrule, {
    visit: 'Declaration',
    enter(node) {
      if (node.property.toLowerCase() !== 'font-family') return;
      csstree.walk(node.value, (v) => {
        if (v.type === 'String' && !fam) fam = v.value;
        if (v.type === 'Identifier' && !fam) fam = v.name;
      });
    },
  });
  return fam;
}

/* ---------- pretty printer ---------- */

export type SelectorTransform = (selector: string) => string;

function declToString(decl: csstree.CssNode, indent: string): string {
  if (decl.type === 'Declaration') {
    const value = csstree.generate(decl.value).replace(/,(?=\S)/g, ', ');
    const bang = decl.important ? ' !important' : '';
    return `${indent}${decl.property}: ${value}${bang};`;
  }
  return `${indent}${csstree.generate(decl)}`;
}

function nodeToString(
  node: csstree.CssNode,
  indent: string,
  transform?: SelectorTransform,
): string | null {
  if (node.type === 'Rule') {
    const selRaw = csstree.generate(node.prelude);
    let sels = splitTopLevelCommas(selRaw);
    if (transform) sels = sels.map(transform);
    const parts: string[] = [];
    (node.block.children as csstree.List<csstree.CssNode>).forEach((child) => {
      if (child.type === 'Rule' || child.type === 'Atrule') {
        const nested = nodeToString(child, indent + '  ', transform);
        if (nested) parts.push(nested);
      } else {
        parts.push(declToString(child, indent + '  '));
      }
    });
    if (parts.length === 0) return null;
    return `${indent}${sels.join(`,\n${indent}`)} {\n${parts.join('\n')}\n${indent}}`;
  }
  if (node.type === 'Atrule') {
    const prelude = node.prelude ? ` ${csstree.generate(node.prelude)}` : '';
    if (!node.block) return `${indent}@${node.name}${prelude};`;
    const isConditional = ['media', 'supports', 'layer', 'container'].includes(
      csstree.keyword(node.name).basename,
    );
    const inner: string[] = [];
    (node.block.children as csstree.List<csstree.CssNode>).forEach((child) => {
      if (child.type === 'Rule' || child.type === 'Atrule') {
        // inside @keyframes, frame selectors must NOT get the wrapper transform
        const t = isConditional ? transform : undefined;
        const nested = nodeToString(child, indent + '  ', t);
        if (nested) inner.push(nested);
      } else {
        inner.push(declToString(child, indent + '  '));
      }
    });
    if (inner.length === 0) return null;
    return `${indent}@${node.name}${prelude} {\n${inner.join('\n')}\n${indent}}`;
  }
  const generated = csstree.generate(node);
  return generated ? indent + generated : null;
}

export function formatAst(ast: csstree.CssNode, transform?: SelectorTransform): string {
  const out: string[] = [];
  if (ast.type === 'StyleSheet') {
    (ast.children as csstree.List<csstree.CssNode>).forEach((child) => {
      const s = nodeToString(child, '', transform);
      if (s) out.push(s);
    });
  }
  return out.join('\n\n') + (out.length ? '\n' : '');
}

/* ---------- main entry ---------- */

export interface CleanCssResult {
  css: string;
  fonts: string[];
}

export function cleanCss(
  rawCss: string,
  usage: CssUsage,
  renameMap: Record<string, string>,
): CleanCssResult {
  const ast = csstree.parse(rawCss, {
    parseCustomProperty: false,
    onParseError: () => {},
  }) as csstree.StyleSheet;

  renameClassesInAst(ast, renameMap);

  const seen = new Set<string>();
  const usedAnimations = collectAnimationNames(ast);
  const usedFamilies = collectFontFamilies(ast);
  const keptFonts = new Set<string>();

  const filterChildren = (list: csstree.List<csstree.CssNode>): csstree.List<csstree.CssNode> => {
    const kept: csstree.CssNode[] = [];
    list.forEach((node) => {
      if (node.type === 'Rule') {
        if (!filterRulePrelude(node, usage)) return;
        const key = csstree.generate(node);
        if (seen.has(key)) return;
        seen.add(key);
        kept.push(node);
      } else if (node.type === 'Atrule') {
        const base = csstree.keyword(node.name).basename;
        if (base === 'keyframes') {
          const name = node.prelude ? csstree.generate(node.prelude).trim() : '';
          if (!usedAnimations.has(name)) return;
          const key = csstree.generate(node);
          if (seen.has(key)) return;
          seen.add(key);
          kept.push(node);
        } else if (base === 'font-face') {
          const fam = fontFaceFamily(node);
          if (fam && usedFamilies.size && !usedFamilies.has(fam.toLowerCase())) return;
          const key = csstree.generate(node);
          if (seen.has(key)) return;
          seen.add(key);
          if (fam) keptFonts.add(fam);
          kept.push(node);
        } else if ((base === 'media' || base === 'supports') && node.block) {
          node.block.children = filterChildren(
            node.block.children as csstree.List<csstree.CssNode>,
          );
          if (!node.block.children.isEmpty) kept.push(node);
        } else {
          const key = csstree.generate(node);
          if (seen.has(key)) return;
          seen.add(key);
          kept.push(node);
        }
      } else {
        kept.push(node);
      }
    });
    return new csstree.List<csstree.CssNode>().fromArray(kept);
  };

  ast.children = filterChildren(ast.children as csstree.List<csstree.CssNode>);

  return { css: formatAst(ast), fonts: Array.from(keptFonts).sort() };
}

/**
 * Namespace every selector under a wrapper class (used by the Webflow serializer
 * so embedded CSS can't collide with the user's existing site styles).
 */
export function namespaceCss(css: string, wrapperClass: string): string {
  const ast = csstree.parse(css, { onParseError: () => {} });
  const transform: SelectorTransform = (sel) => {
    const trimmed = sel.trim();
    // html/body/:root become the wrapper itself
    const rootish = trimmed.replace(/^(html|body|:root)(\b|(?=[.:#[]))/i, '');
    if (rootish !== trimmed) {
      const rest = rootish.trim();
      return rest ? `.${wrapperClass} ${rest}`.trim() : `.${wrapperClass}`;
    }
    return `.${wrapperClass} ${trimmed}`;
  };
  return formatAst(ast, transform);
}

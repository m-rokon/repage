import { useEffect, useState } from 'react';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

const HIGHLIGHT_LIMIT = 120_000; // very large files render as plain text

const LANGS = ['html', 'css', 'javascript', 'tsx', 'liquid', 'json'];

// fine-grained bundle: only the grammars Repage actually outputs
let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import('shiki/themes/github-dark-default.mjs')],
      langs: [
        import('shiki/langs/html.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/liquid.mjs'),
        import('shiki/langs/json.mjs'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }
  return highlighterPromise;
}

export default function CodePanel({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (code.length > HIGHLIGHT_LIMIT) return;
    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        const lang = LANGS.includes(language) ? language : 'html';
        setHtml(hl.codeToHtml(code, { lang, theme: 'github-dark-default' }));
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="code-panel">
      <button className="copy-btn" onClick={copy}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      {html ? (
        <div className="code-scroll" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="code-scroll">
          <pre className="plain-code">
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

/** Static serializer: IR -> index.html + styles.css + script.js (plan §4.4). */

import type { ExtractionResult, SerializerResult } from '../types.js';
import { escapeHtml, renderHtml } from './html.js';

export function buildScriptJs(result: ExtractionResult): string {
  const custom = result.scripts.filter((s) => s.classification === 'custom');
  const framework = result.scripts.filter((s) => s.classification === 'framework');
  const tracking = result.scripts.filter((s) => s.classification === 'tracking');

  const lines: string[] = [
    '/**',
    ` * Repage — scripts extracted from ${result.url}`,
    ' *',
    ' * Only inline scripts that look site-specific ("likely custom") are included',
    ' * below. Review before using: data fetching, forms, auth and business logic',
    ' * are NOT recreated by Repage — wire those up yourself (see TODOs).',
    ' */',
    '',
  ];

  const externalCustom = custom.filter((s) => s.kind === 'external');
  if (externalCustom.length) {
    lines.push('/* External scripts that look custom — add <script src> tags if needed:');
    for (const s of externalCustom) lines.push(` *   ${s.src}`);
    lines.push(' */', '');
  }
  if (framework.length) {
    lines.push('/* Framework/plugin scripts detected on the page (NOT included):');
    for (const s of framework.slice(0, 20)) lines.push(` *   ${s.src ?? '(inline framework bootstrap)'}`);
    lines.push(' */', '');
  }
  if (tracking.length) {
    lines.push(`/* ${tracking.length} tracking/analytics script(s) detected and intentionally dropped. */`, '');
  }

  const inlineCustom = custom.filter((s) => s.kind === 'inline' && s.content);
  if (inlineCustom.length) {
    lines.push('// TODO(repage): review each block — selectors may reference elements that were cleaned.');
    inlineCustom.forEach((s, i) => {
      lines.push('', `/* ---- inline script ${i + 1} ---- */`, s.content ?? '');
    });
  } else {
    lines.push('// No site-specific inline scripts survived extraction.');
  }
  return lines.join('\n') + '\n';
}

export function serializeStatic(result: ExtractionResult): SerializerResult {
  const bodyHtml = renderHtml(result.ir, { dynamicComments: true }, 2);

  const html = `<!doctype html>
<!--
  Repage extract of ${result.url}
  Extracted ${result.extractedAt}

  This is a structural rebuild of the rendered page — not a functional clone.
  Forms, data fetching, auth and backend logic are not wired up.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(result.title)}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
${bodyHtml}
  <script src="./script.js"></script>
</body>
</html>
`;

  const css = `/* Repage extract of ${result.url} — cleaned, deduplicated, unused selectors dropped. */\n\n${result.css}`;

  return {
    mode: 'static',
    label: 'Static HTML/CSS/JS',
    disclaimer:
      'Structurally faithful static rebuild. Interactive behavior driven by the original site’s JavaScript (menus, sliders, forms) is not recreated — check script.js for what was extracted and what was dropped.',
    files: [
      { name: 'index.html', language: 'html', content: html },
      { name: 'styles.css', language: 'css', content: css },
      { name: 'script.js', language: 'javascript', content: buildScriptJs(result) },
    ],
  };
}

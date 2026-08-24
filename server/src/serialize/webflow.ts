/** Webflow serializer: IR -> single self-contained embed block, CSS namespaced to avoid collisions (plan §4.4). */

import type { ExtractionResult, SerializerResult } from '../types.js';
import { renderHtml } from './html.js';
import { namespaceCss } from '../clean/css.js';

const WRAPPER_CLASS = 'repage-embed';

export function serializeWebflow(result: ExtractionResult): SerializerResult {
  const html = renderHtml(result.ir, { dynamicComments: true }, 1);
  const scopedCss = namespaceCss(result.css, WRAPPER_CLASS);

  const embed = `<!--
  Webflow embed block — extracted from ${result.url} by Repage.

  Install: drop an "Embed" element onto your Webflow page and paste this whole
  block into it. All CSS is namespaced under .${WRAPPER_CLASS} so it won't
  collide with your existing Webflow classes.

  Note: Webflow embeds have a size limit (50,000 characters on most plans).
  If this block exceeds it, host styles.css externally or split sections.
-->
<div class="${WRAPPER_CLASS}">
${html}
</div>
<style>
${scopedCss}
</style>
`;

  return {
    mode: 'webflow',
    label: 'Webflow Embed',
    disclaimer:
      'Paste into a Webflow Embed element. CSS is namespaced under .repage-embed to avoid clashing with your site styles. This is not a Webflow project import (Webflow does not expose that format) — the embed is not editable with Webflow’s visual designer.',
    files: [{ name: 'webflow-embed.html', language: 'html', content: embed }],
  };
}

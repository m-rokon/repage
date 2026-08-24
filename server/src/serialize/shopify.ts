/** Shopify serializer: IR -> Liquid section with {% schema %}, plus a Custom Liquid variant (plan §4.4). */

import type { ExtractionResult, SerializerResult } from '../types.js';
import { renderHtml } from './html.js';
import { buildScriptJs } from './staticOut.js';

function sectionHandle(title: string): string {
  const handle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return handle || 'repage-section';
}

export function serializeShopify(result: ExtractionResult): SerializerResult {
  const handle = sectionHandle(result.title);
  const html = renderHtml(result.ir, { dynamicComments: true }, 1);
  const indentedCss = result.css
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');

  const liquid = `{% comment %}
  ${handle}.liquid — extracted from ${result.url} by Repage.

  Install: save as sections/${handle}.liquid in your theme, then add the
  section in the theme editor.

  TODO(repage): repeated patterns marked below were probably CMS loops on the
  source site — replace them with {% for %} loops over your own products,
  blogs or metaobjects. Forms/checkout logic are NOT recreated.
{% endcomment %}

<section class="repage-{{ section.id }}" style="padding-top: {{ section.settings.padding_top }}px; padding-bottom: {{ section.settings.padding_bottom }}px;">
${html}
</section>

{% style %}
${indentedCss}
{% endstyle %}

{% schema %}
{
  "name": "Repage: ${handle.slice(0, 18)}",
  "tag": "section",
  "settings": [
    {
      "type": "range",
      "id": "padding_top",
      "label": "Top padding",
      "min": 0,
      "max": 120,
      "step": 4,
      "unit": "px",
      "default": 0
    },
    {
      "type": "range",
      "id": "padding_bottom",
      "label": "Bottom padding",
      "min": 0,
      "max": 120,
      "step": 4,
      "unit": "px",
      "default": 0
    }
  ],
  "presets": [
    {
      "name": "Repage: ${handle.slice(0, 18)}"
    }
  ]
}
{% endschema %}
`;

  const customLiquid = `<!-- Custom Liquid variant — paste into a "Custom Liquid" block in the theme editor. -->
<!-- Extracted from ${result.url} by Repage. -->
<div class="repage-custom">
${html}
</div>
<style>
${result.css}
</style>
`;

  return {
    mode: 'shopify',
    label: 'Shopify Liquid',
    disclaimer:
      'Copy the .liquid file into your theme’s sections/ folder (or use the Custom Liquid variant for a quick paste). Product data, cart and checkout logic are not recreated — repeated content sections carry TODOs to convert into {% for %} loops.',
    files: [
      { name: `${handle}.liquid`, language: 'liquid', content: liquid },
      { name: 'custom-liquid-block.liquid', language: 'liquid', content: customLiquid },
      { name: 'script.js', language: 'javascript', content: buildScriptJs(result) },
    ],
  };
}

/** Framer serializer: IR -> single Code Component .tsx using addPropertyControls (plan §4.4). */

import type { ExtractionResult, SerializerResult } from '../types.js';
import { renderHtml } from './html.js';
import { componentNameFromTitle } from './react.js';

/** Escape content for embedding inside a JS template literal. */
function escapeTemplate(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function serializeFramer(result: ExtractionResult): SerializerResult {
  const componentName = componentNameFromTitle(result.title);
  const html = renderHtml(result.ir, { dynamicComments: true }, 0);

  const tsx = `/**
 * ${componentName} — Framer Code Component, extracted from ${result.url} by Repage.
 *
 * Paste into Framer: Assets panel -> Code -> New Code File, replace the contents,
 * then drag the component onto the canvas.
 *
 * TODO(repage): this renders the extracted markup verbatim. Links, forms and
 * data-driven sections are static — wire real behavior up in Framer or replace
 * sections with native Framer layers as needed.
 */
import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

const css = \`
${escapeTemplate(result.css)}
\`

const html = \`
${escapeTemplate(html)}
\`

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
export default function ${componentName}(props: {
  background: string
  padding: number
  style?: React.CSSProperties
}) {
  const { background, padding, style } = props
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        background,
        padding,
        ...style,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

addPropertyControls(${componentName}, {
  background: {
    type: ControlType.Color,
    title: "Background",
    defaultValue: "#ffffff",
  },
  padding: {
    type: ControlType.Number,
    title: "Padding",
    defaultValue: 0,
    min: 0,
    max: 200,
  },
})
`;

  return {
    mode: 'framer',
    label: 'Framer Code Component',
    disclaimer:
      'This is a Code Component (paste-in), not a native .framer file — Framer does not expose that format. The markup renders inside the component; use the property controls for background/padding, and rebuild key sections as native Framer layers where you need canvas editing.',
    files: [{ name: `${componentName}.tsx`, language: 'tsx', content: tsx }],
  };
}

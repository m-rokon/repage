/** React + TypeScript serializer: IR -> Component.tsx + Component.module.css (plan §4.4). */

import type { ExtractionResult, IRNode, SerializerResult } from '../types.js';
import { VOID_ELEMENTS } from './html.js';

const ATTR_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  playsinline: 'playsInline',
  srcset: 'srcSet',
  crossorigin: 'crossOrigin',
  novalidate: 'noValidate',
  spellcheck: 'spellCheck',
  contenteditable: 'contentEditable',
  'xlink:href': 'xlinkHref',
  'xml:lang': 'xmlLang',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  frameborder: 'frameBorder',
  allowfullscreen: 'allowFullScreen',
  referrerpolicy: 'referrerPolicy',
  enctype: 'encType',
  formaction: 'formAction',
  datetime: 'dateTime',
  accesskey: 'accessKey',
  inputmode: 'inputMode',
  enterkeyhint: 'enterKeyHint',
  fetchpriority: 'fetchPriority',
};

function toCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function jsxAttrName(name: string): string {
  if (ATTR_MAP[name]) return ATTR_MAP[name];
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  if (name.includes('-')) return toCamel(name); // svg presentation attrs etc.
  return name;
}

function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function styleAttrToObject(style: string): string {
  const entries: string[] = [];
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    const key = prop.startsWith('--') ? JSON.stringify(prop) : toCamel(prop);
    entries.push(`${key}: ${JSON.stringify(value)}`);
  }
  return `{ ${entries.join(', ')} }`;
}

function classNameExpr(classes: string[]): string {
  const refs = classes.map((c) =>
    isValidIdentifier(c) ? `styles.${c}` : `styles[${JSON.stringify(c)}]`,
  );
  if (refs.length === 1) return `{${refs[0]}}`;
  return `{cx(${refs.join(', ')})}`;
}

function jsxText(text: string): string {
  if (/[{}<>]/.test(text)) return `{${JSON.stringify(text)}}`;
  return text.replace(/&/g, '&amp;');
}

interface JsxState {
  usesCx: boolean;
  usesRawSvg: boolean;
  usesStyles: boolean;
}

function renderJsx(node: IRNode, state: JsxState, depth: number): string {
  const pad = '  '.repeat(depth);

  if (node.type === 'text') {
    return pad + jsxText(node.text ?? '');
  }

  const tag = node.tag ?? 'div';

  if (node.raw) {
    state.usesRawSvg = true;
    return `${pad}<span dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.raw)} }} />`;
  }

  const attrParts: string[] = [];
  const classes = node.classes ?? [];
  if (classes.length) {
    if (classes.length > 1) state.usesCx = true;
    state.usesStyles = true;
    attrParts.push(`className=${classNameExpr(classes)}`);
  }
  for (const [rawName, value] of Object.entries(node.attrs ?? {})) {
    const name = jsxAttrName(rawName);
    if (name === 'style') {
      attrParts.push(`style={${styleAttrToObject(value)}}`);
    } else if (value === '') {
      attrParts.push(name);
    } else {
      attrParts.push(`${name}=${JSON.stringify(value)}`);
    }
  }
  const attrString = attrParts.length ? ' ' + attrParts.join(' ') : '';

  const marker = node.meta?.dynamicGroupStart
    ? `${pad}{/* TODO(repage): the next ${node.meta.dynamicGroupSize} siblings are a repeated pattern — likely a CMS/data loop. Consider extracting an item component and mapping over typed data. */}\n`
    : '';

  const children = node.children ?? [];
  if (VOID_ELEMENTS.has(tag) || children.length === 0) {
    return `${marker}${pad}<${tag}${attrString} />`;
  }
  if (children.length === 1 && children[0].type === 'text' && (children[0].text ?? '').length < 60) {
    return `${marker}${pad}<${tag}${attrString}>${jsxText((children[0].text ?? '').trim())}</${tag}>`;
  }
  const inner = children.map((c) => renderJsx(c, state, depth + 1)).join('\n');
  return `${marker}${pad}<${tag}${attrString}>\n${inner}\n${pad}</${tag}>`;
}

export function componentNameFromTitle(title: string): string {
  const name = title
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  const valid = /^[A-Za-z]/.test(name) ? name : `Page${name}`;
  return valid || 'ExtractedPage';
}

export function serializeReact(result: ExtractionResult): SerializerResult {
  const componentName = componentNameFromTitle(result.title);
  const state: JsxState = { usesCx: false, usesRawSvg: false, usesStyles: false };
  const jsx = renderJsx(result.ir, state, 2);

  const cxHelper = state.usesCx
    ? `\nconst cx = (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(' ');\n`
    : '';
  const stylesImport = state.usesStyles
    ? `import styles from './${componentName}.module.css';\n`
    : `import './${componentName}.module.css'; // no class-based styles — element selectors only\n`;

  const tsx = `/**
 * ${componentName} — extracted from ${result.url} by Repage.
 *
 * TODO(repage): this is a structural rebuild, not a functional clone.
 *  - Data fetching, forms, auth and business logic are not wired up.
 *  - Sections marked "repeated pattern" were probably CMS loops — replace
 *    them with a .map() over your own typed data.
 *  - Element-level selectors in the CSS module (e.g. "h2 { ... }") are global
 *    in CSS Modules; scope them if they clash with your app.
 */
${stylesImport}${cxHelper}
export default function ${componentName}() {
  return (
${jsx}
  );
}
`;

  const css = `/* ${componentName}.module.css — extracted from ${result.url} by Repage. */\n\n${result.css}`;

  return {
    mode: 'react',
    label: 'React + TypeScript',
    disclaimer:
      'Drop the two files into any React/Vite/Next project. Class styles use CSS Modules; element-level selectors remain global. Repeated CMS-loop sections are marked with TODOs for you to convert to .map() over real data.',
    files: [
      { name: `${componentName}.tsx`, language: 'tsx', content: tsx },
      { name: `${componentName}.module.css`, language: 'css', content: css },
    ],
  };
}

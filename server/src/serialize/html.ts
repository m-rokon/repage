/** Shared IR -> HTML string renderer used by several serializers. */

import type { IRNode } from '../types.js';

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export interface RenderHtmlOptions {
  indent?: string;
  /** emit `<!-- repage: likely dynamic -->` markers before detected CMS-loop groups */
  dynamicComments?: boolean;
}

function attrsToString(node: IRNode): string {
  const parts: string[] = [];
  const classes = node.classes ?? [];
  if (classes.length) parts.push(`class="${escapeAttr(classes.join(' '))}"`);
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (value === '') parts.push(key);
    else parts.push(`${key}="${escapeAttr(value)}"`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function isShortLeaf(node: IRNode): boolean {
  const children = node.children ?? [];
  return (
    children.every((c) => c.type === 'text') &&
    children.reduce((n, c) => n + (c.text?.length ?? 0), 0) < 80
  );
}

export function renderHtml(node: IRNode, opts: RenderHtmlOptions = {}, depth = 0): string {
  const indentUnit = opts.indent ?? '  ';
  const pad = indentUnit.repeat(depth);

  if (node.type === 'text') {
    return pad + escapeHtml(node.text ?? '');
  }

  const tag = node.tag ?? 'div';

  if (node.raw) {
    // verbatim passthrough (inline SVG)
    return node.raw
      .split('\n')
      .map((line) => pad + line)
      .join('\n');
  }

  const open = `<${tag}${attrsToString(node)}>`;
  if (VOID_ELEMENTS.has(tag)) return pad + open;

  const children = node.children ?? [];
  const marker =
    opts.dynamicComments && node.meta?.dynamicGroupStart
      ? `${pad}<!-- repage: the next ${node.meta.dynamicGroupSize} siblings look like a repeated pattern — probably a CMS/data loop, not static markup -->\n`
      : '';

  if (children.length === 0) return `${marker}${pad}${open}</${tag}>`;
  if (isShortLeaf(node)) {
    const text = children.map((c) => escapeHtml(c.text ?? '')).join('');
    return `${marker}${pad}${open}${text.trim()}</${tag}>`;
  }

  const inner = children.map((c) => renderHtml(c, opts, depth + 1)).join('\n');
  return `${marker}${pad}${open}\n${inner}\n${pad}</${tag}>`;
}

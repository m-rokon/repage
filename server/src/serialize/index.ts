/** Serializer registry — one entry per output mode (plan §3, §4.4). */

import type { OutputMode, Serializer } from '../types.js';
import { serializeStatic } from './staticOut.js';
import { serializeReact } from './react.js';
import { serializeFramer } from './framer.js';
import { serializeShopify } from './shopify.js';
import { serializeWebflow } from './webflow.js';

export const serializers: Record<OutputMode, Serializer> = {
  static: serializeStatic,
  react: serializeReact,
  framer: serializeFramer,
  shopify: serializeShopify,
  webflow: serializeWebflow,
};

export const MODES: { mode: OutputMode; label: string }[] = [
  { mode: 'static', label: 'Static HTML/CSS/JS' },
  { mode: 'react', label: 'React + TypeScript' },
  { mode: 'framer', label: 'Framer' },
  { mode: 'shopify', label: 'Shopify Liquid' },
  { mode: 'webflow', label: 'Webflow Embed' },
];

export function isOutputMode(value: string): value is OutputMode {
  return Object.prototype.hasOwnProperty.call(serializers, value);
}

/**
 * Shared types for the Repage pipeline.
 *
 * The Intermediate Representation (IR) is the contract between the
 * extraction/cleaning stages and the per-platform serializers.
 * It is deliberately platform-agnostic: adding a new output target
 * (Vue, Astro, ...) should only mean writing a new serializer.
 */

export interface IRMeta {
  /** Repeated-sibling pattern detected — probably a CMS loop, not static markup. */
  likelyDynamic?: boolean;
  /** True on the first node of a detected repeated group (used to emit one TODO marker per group). */
  dynamicGroupStart?: boolean;
  /** Number of siblings in the detected repeated group (set on the group-start node). */
  dynamicGroupSize?: number;
  /** Element was display:none / hidden at capture time (may be JS-toggled UI). */
  hidden?: boolean;
  /** Original selector-ish identity before cleaning (e.g. ".wp-block-hero"). */
  sourceSelector?: string;
}

export interface IRNode {
  type: 'element' | 'text';
  /** element only */
  tag?: string;
  /** element only — attributes minus `class` (kept separately) and minus stripped cruft */
  attrs?: Record<string, string>;
  /** element only — class list after cleaning/renaming */
  classes?: string[];
  /** text only */
  text?: string;
  /** verbatim markup passthrough (inline SVGs are kept whole rather than serialized node-by-node) */
  raw?: string;
  children?: IRNode[];
  meta?: IRMeta;
}

export type ScriptClassification = 'framework' | 'tracking' | 'custom';

export interface ScriptInfo {
  kind: 'inline' | 'external';
  src?: string;
  content?: string;
  classification: ScriptClassification;
}

export interface ExtractionResult {
  url: string;
  origin: string;
  title: string;
  extractedAt: string;
  ir: IRNode;
  /** Cleaned, deduplicated, pretty-printed CSS covering only selectors used by the IR. */
  css: string;
  scripts: ScriptInfo[];
  /** font-family names referenced by @font-face rules that survived cleaning */
  fonts: string[];
  warnings: string[];
  /** map of auto-generated class name -> renamed semantic-ish name */
  renamedClasses: Record<string, string>;
}

/* ---------- serializer contract ---------- */

export type OutputMode = 'static' | 'react' | 'framer' | 'shopify' | 'webflow';

export interface OutputFile {
  name: string;
  /** language hint for syntax highlighting on the frontend */
  language: string;
  content: string;
}

export interface SerializerResult {
  mode: OutputMode;
  label: string;
  /** expectation-setting text shown in the UI at the point of use (plan §2) */
  disclaimer: string;
  files: OutputFile[];
}

export type Serializer = (result: ExtractionResult) => SerializerResult;

/* ---------- raw capture (browser -> node), pre-cleaning ---------- */

export interface RawCapturedScript {
  src?: string;
  content?: string;
  scriptType?: string;
}

export interface RawCapture {
  title: string;
  tree: IRNode | null;
  css: string;
  scripts: RawCapturedScript[];
  warnings: string[];
}

/* ---------- job store ---------- */

export type JobPhase = 'queued' | 'fetching' | 'extracting' | 'cleaning' | 'done' | 'error';

export interface Job {
  id: string;
  url: string;
  phase: JobPhase;
  error?: string;
  createdAt: number;
  result?: ExtractionResult;
}

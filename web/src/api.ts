/** Typed client for the Repage API. */

export type OutputMode = 'static' | 'react' | 'framer' | 'shopify' | 'webflow';
export type JobPhase = 'queued' | 'fetching' | 'extracting' | 'cleaning' | 'done' | 'error';

export interface JobStatus {
  jobId: string;
  url: string;
  phase: JobPhase;
  error?: string;
  title?: string;
  warnings?: string[];
  fonts?: string[];
  modes?: { mode: OutputMode; label: string }[];
  stats?: { cssBytes: number; scripts: number; renamedClasses: number };
}

export interface OutputFile {
  name: string;
  language: string;
  content: string;
}

export interface SerializerResult {
  mode: OutputMode;
  label: string;
  disclaimer: string;
  files: OutputFile[];
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function startExtraction(url: string): Promise<{ jobId: string }> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handle(res);
}

export async function getJob(jobId: string): Promise<JobStatus> {
  return handle(await fetch(`/api/jobs/${jobId}`));
}

export async function getOutput(jobId: string, mode: OutputMode): Promise<SerializerResult> {
  return handle(await fetch(`/api/jobs/${jobId}/output/${mode}`));
}

export function previewUrl(jobId: string): string {
  return `/api/jobs/${jobId}/preview`;
}

export function downloadUrl(jobId: string, mode: OutputMode): string {
  return `/api/jobs/${jobId}/download/${mode}`;
}

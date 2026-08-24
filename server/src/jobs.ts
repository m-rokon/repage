/**
 * In-memory job store + extraction cache (plan §4.6).
 *
 * Extracted IR is cached by normalized URL with a TTL, so re-running different
 * output modes on the same URL doesn't re-scrape. A queue (BullMQ/Redis) is a
 * deliberate non-goal for v1 — jobs run in-process, one Playwright context each.
 */

import { randomUUID } from 'node:crypto';
import type { Job, JobPhase } from './types.js';
import { extractPage } from './extract/extractor.js';
import { runCleaningPass } from './clean/clean.js';

const CACHE_TTL_MS = 15 * 60 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_EXTRACTIONS = 3;

const jobs = new Map<string, Job>();
const cacheByUrl = new Map<string, { jobId: string; at: number }>();
let running = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT_EXTRACTIONS) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { running++; resolve(); }));
}

function releaseSlot(): void {
  running--;
  const next = waiting.shift();
  if (next) next();
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

export function startExtraction(url: string): Job {
  const normalized = normalizeUrl(url);

  const cached = cacheByUrl.get(normalized);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    const cachedJob = jobs.get(cached.jobId);
    if (cachedJob && (cachedJob.phase === 'done' || cachedJob.phase !== 'error')) {
      return cachedJob;
    }
  }

  const job: Job = {
    id: randomUUID(),
    url: normalized,
    phase: 'queued',
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  cacheByUrl.set(normalized, { jobId: job.id, at: Date.now() });

  void runJob(job);
  return job;
}

async function runJob(job: Job): Promise<void> {
  await acquireSlot();
  try {
    const capture = await extractPage(job.url, {
      onPhase: (phase) => {
        job.phase = phase;
      },
    });
    job.phase = 'cleaning';
    job.result = runCleaningPass(job.url, capture);
    job.phase = 'done';
  } catch (err) {
    job.phase = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    cacheByUrl.delete(job.url);
  } finally {
    releaseSlot();
  }
}

/* periodic sweep so the maps don't grow forever */
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  for (const [url, entry] of cacheByUrl) {
    if (now - entry.at > CACHE_TTL_MS || !jobs.has(entry.jobId)) cacheByUrl.delete(url);
  }
}, 60_000).unref();

/** API layer (plan §4.6): Fastify app with rate limiting, job endpoints, preview and zip download. */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import JSZip from 'jszip';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getJob, startExtraction } from './jobs.js';
import { validateTargetUrl } from './urlValidation.js';
import { isOutputMode, MODES, serializers } from './serialize/index.js';
import { renderHtml, escapeHtml } from './serialize/html.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
  });

  // serve the built frontend if present (production mode)
  const webDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../web/dist',
  );
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
  }

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: { url?: string } }>('/api/extract', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const validated = validateTargetUrl(String(req.body?.url ?? ''));
    if (!validated.ok) {
      return reply.code(400).send({ error: validated.error });
    }
    const job = startExtraction(validated.url);
    return { jobId: job.id, phase: job.phase };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found (it may have expired).' });
    return {
      jobId: job.id,
      url: job.url,
      phase: job.phase,
      error: job.error,
      ...(job.phase === 'done' && job.result
        ? {
            title: job.result.title,
            warnings: job.result.warnings,
            fonts: job.result.fonts,
            modes: MODES,
            stats: {
              cssBytes: job.result.css.length,
              scripts: job.result.scripts.length,
              renamedClasses: Object.keys(job.result.renamedClasses).length,
            },
          }
        : {}),
    };
  });

  app.get<{ Params: { id: string; mode: string } }>(
    '/api/jobs/:id/output/:mode',
    async (req, reply) => {
      const job = getJob(req.params.id);
      if (!job) return reply.code(404).send({ error: 'Job not found (it may have expired).' });
      if (job.phase !== 'done' || !job.result) {
        return reply.code(409).send({ error: `Job is not finished (phase: ${job.phase}).` });
      }
      if (!isOutputMode(req.params.mode)) {
        return reply.code(400).send({ error: `Unknown output mode: ${req.params.mode}` });
      }
      return serializers[req.params.mode](job.result);
    },
  );

  app.get<{ Params: { id: string } }>('/api/jobs/:id/preview', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job || job.phase !== 'done' || !job.result) {
      return reply.code(404).type('text/html').send('<p>Preview not available.</p>');
    }
    const r = job.result;
    const body = renderHtml(r.ir, {}, 2);
    // single self-contained document; <base> helps any still-relative asset URLs
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${escapeHtml(r.origin)}/" />
<title>Repage preview — ${escapeHtml(r.title)}</title>
<style>
${r.css}
</style>
</head>
<body>
${body}
</body>
</html>`;
    return reply
      .type('text/html')
      .header('Content-Security-Policy', "script-src 'none'")
      .send(html);
  });

  app.get<{ Params: { id: string; mode: string } }>(
    '/api/jobs/:id/download/:mode',
    async (req, reply) => {
      const job = getJob(req.params.id);
      if (!job || job.phase !== 'done' || !job.result) {
        return reply.code(404).send({ error: 'Job not found or not finished.' });
      }
      if (!isOutputMode(req.params.mode)) {
        return reply.code(400).send({ error: `Unknown output mode: ${req.params.mode}` });
      }
      const output = serializers[req.params.mode](job.result);
      const zip = new JSZip();
      zip.file(
        'README.txt',
        `Repage extract of ${job.result.url}\nMode: ${output.label}\nExtracted: ${job.result.extractedAt}\n\n${output.disclaimer}\n`,
      );
      for (const file of output.files) zip.file(file.name, file.content);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const safeHost = new URL(job.result.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
      return reply
        .type('application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="repage-${safeHost}-${req.params.mode}.zip"`,
        )
        .send(buffer);
    },
  );

  return app;
}

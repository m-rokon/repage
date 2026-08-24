/**
 * Extraction spike (plan §6, milestone 1): CLI that runs the full pipeline on a
 * URL and dumps every output mode to disk for manual quality inspection.
 *
 *   npm run spike -w server -- https://example.com [outDir]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPage, closeBrowser } from './extract/extractor.js';
import { runCleaningPass } from './clean/clean.js';
import { serializers } from './serialize/index.js';
import { validateTargetUrl } from './urlValidation.js';
import type { OutputMode } from './types.js';

const [urlArg, outArg] = process.argv.slice(2);
if (!urlArg) {
  console.error('Usage: npm run spike -w server -- <url> [outDir]');
  process.exit(1);
}
const validated = validateTargetUrl(urlArg);
if (!validated.ok) {
  console.error(`Invalid URL: ${validated.error}`);
  process.exit(1);
}

const outDir = path.resolve(outArg ?? `scratch/${new URL(validated.url).hostname}`);

console.log(`Extracting ${validated.url} ...`);
const started = Date.now();
const capture = await extractPage(validated.url, {
  onPhase: (p) => console.log(`  phase: ${p}`),
});
console.log(`  captured in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('  cleaning...');
const result = runCleaningPass(validated.url, capture);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'ir.json'), JSON.stringify(result.ir, null, 2));

for (const mode of Object.keys(serializers) as OutputMode[]) {
  const output = serializers[mode](result);
  const modeDir = path.join(outDir, mode);
  await mkdir(modeDir, { recursive: true });
  for (const file of output.files) {
    await writeFile(path.join(modeDir, file.name), file.content);
  }
  console.log(`  ${mode}: ${output.files.map((f) => f.name).join(', ')}`);
}

console.log(`\nTitle: ${result.title}`);
console.log(`CSS: ${(result.css.length / 1024).toFixed(1)} KB after cleaning`);
console.log(`Scripts: ${result.scripts.length} (${result.scripts.filter((s) => s.classification === 'custom').length} custom)`);
if (result.warnings.length) {
  console.log('Warnings:');
  for (const w of result.warnings) console.log(`  - ${w}`);
}
console.log(`\nOutput written to ${outDir}`);
await closeBrowser();

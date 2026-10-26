// Standalone renderer evaluation: no bot bootstrap, credentials, or database.
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createCaptchaImageRenderer } = require('../dist/src/services/captcha/imageRenderer.js');
const renderer = createCaptchaImageRenderer();
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const answer = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const samples = [];
const latencies = [];
const initialRss = process.memoryUsage().rss;
let peakRss = initialRss;
const memoryTimer = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 5);
const render = async () => {
  const text = answer();
  const start = performance.now();
  const png = await renderer.render(text);
  latencies.push(performance.now() - start);
  samples.push({ text, png });
};
try {
  // Include a cold start, warm serial work, and the complete two-worker/20-waiter budget.
  for (let index = 0; index < 30; index++) await render();
  await Promise.all(Array.from({ length: 22 }, render));
  const ocr = { tool: 'tesseract', samples: 0, exactMatches: 0, status: 'not requested' };
  if (process.argv.includes('--ocr')) {
    const directory = await mkdtemp(join(tmpdir(), 'drasil-captcha-ocr-'));
    try {
      ocr.version = execFileSync('tesseract', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).split('\n')[0];
      for (const [index, sample] of samples.slice(0, 20).entries()) {
        const path = join(directory, `sample-${index}.png`);
        await writeFile(path, sample.png);
        for (const psm of ['7', '8']) {
          const result = execFileSync(
            'tesseract',
            [
              path,
              'stdout',
              '--psm',
              psm,
              '-l',
              'eng',
              '-c',
              `tessedit_char_whitelist=${alphabet}`,
            ],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 10000,
              env: { ...process.env, OMP_THREAD_LIMIT: '1' },
            }
          );
          ocr.samples++;
          if (result.trim().toUpperCase() === sample.text) ocr.exactMatches++;
        }
      }
      ocr.status = 'observed; 20 distinct images, two PSM configurations each';
    } catch (error) {
      ocr.status = `unverified: ${error.code ?? 'OCR execution failed'}`;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100;
  console.log(
    JSON.stringify({
      platform: `${process.platform}/${process.arch}`,
      node: process.version,
      uid: process.getuid?.(),
      samples: samples.length,
      dimensions: [300, 100],
      maxBytes: Math.max(...samples.map(({ png }) => png.length)),
      latencyMs: {
        cold: Math.round(latencies[0] * 100) / 100,
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: percentile(1),
      },
      memoryBytes: { initialRss, peakRss, finalRss: process.memoryUsage().rss },
      concurrency: { workers: 2, waiting: 20 },
      ocr,
      humanReadability: { samples: 0, status: 'unverified; no human evaluator' },
    })
  );
} finally {
  clearInterval(memoryTimer);
}

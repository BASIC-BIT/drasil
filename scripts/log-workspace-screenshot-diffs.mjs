import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Use the PNG codec already shipped with the pinned browser-test dependency.
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { PNG } = requireWeb('playwright-core/lib/utilsBundle');
export const MAX_CROP_BASE64_LENGTH = 8192;
const MAX_COMPARISONS = 8;
const MAX_CROP_SIDE = 96;

function scanPixels(width, height, changed) {
  let count = 0,
    minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!changed(x, y)) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    count,
    bounds: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
  };
}
function crop(image, bounds) {
  const x = Math.min(image.width - 1, Math.max(0, bounds.x - 8));
  const y = Math.min(image.height - 1, Math.max(0, bounds.y - 8));
  const width = Math.min(MAX_CROP_SIDE, image.width - x, bounds.width + 16);
  const height = Math.min(MAX_CROP_SIDE, image.height - y, bounds.height + 16);
  const output = new PNG({ width, height });
  PNG.bitblt(image, output, x, y, width, height, 0, 0);
  const base64 = PNG.sync.write(output).toString('base64');
  const metadata = { x, y, width, height };
  return base64.length <= MAX_CROP_BASE64_LENGTH
    ? { ...metadata, base64 }
    : { ...metadata, omitted: 'PNG exceeds bounded log payload' };
}
export function screenshotDiagnostic(expected, actual, diff) {
  const raw = scanPixels(
    Math.max(expected.width, actual.width),
    Math.max(expected.height, actual.height),
    (x, y) => {
      const inExpected = x < expected.width && y < expected.height;
      const inActual = x < actual.width && y < actual.height;
      if (!inExpected || !inActual) return inExpected !== inActual;
      const ei = (y * expected.width + x) * 4,
        ai = (y * actual.width + x) * 4;
      return [0, 1, 2, 3].some(
        (channel) => expected.data[ei + channel] !== actual.data[ai + channel]
      );
    }
  );
  // Playwright's thresholded diff marks changed pixels red; yellow marks antialiasing.
  // Report both this exact marker count and raw RGBA differences, without rerunning a looser comparator.
  const marked = diff
    ? scanPixels(diff.width, diff.height, (x, y) => {
        const i = (y * diff.width + x) * 4;
        return (
          diff.data[i] === 255 &&
          diff.data[i + 1] === 0 &&
          diff.data[i + 2] === 0 &&
          diff.data[i + 3] === 255
        );
      })
    : null;
  const bounds = marked?.bounds ?? raw.bounds;
  const crops = {};
  if (bounds) {
    for (const [name, image] of Object.entries({ expected, actual, diff })) {
      if (image) crops[name] = crop(image, bounds);
    }
  }
  return {
    expectedSize: { width: expected.width, height: expected.height },
    actualSize: { width: actual.width, height: actual.height },
    changedPixels: raw.count,
    changedBounds: raw.bounds,
    thresholdDiffPixels: marked?.count ?? null,
    thresholdDiffBounds: marked?.bounds ?? null,
    crops,
  };
}
function logFailures(directories) {
  const files = directories.flatMap((directory) => {
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { recursive: true })
      .filter((file) => {
        const name = path.basename(file);
        return (
          /^workspace-(case|inbox)-(light|dark)-\d+-actual\.png$/.test(name) ||
          /^operations-(linux|win32)-(light|dark)-actual\.png$/.test(name)
        );
      })
      .sort()
      .map((file) => path.join(directory, file));
  });
  for (const file of files.slice(0, MAX_COMPARISONS)) {
    try {
      const actualPath = file;
      const expectedPath = actualPath.replace(/-actual\.png$/, '-expected.png');
      const isOperations = path.basename(file).startsWith('operations-');
      const baselinePath = path.join(
        `apps/web/e2e/${isOperations ? 'visual' : 'moderation-workspace'}.spec.ts-snapshots`,
        path.basename(file).replace(/-actual\.png$/, isOperations ? '.png' : '-linux.png')
      );
      const diffPath = actualPath.replace(/-actual\.png$/, '-diff.png');
      const read = (filename) => PNG.sync.read(fs.readFileSync(filename));
      const result = screenshotDiagnostic(
        read(fs.existsSync(expectedPath) ? expectedPath : baselinePath),
        read(actualPath),
        fs.existsSync(diffPath) ? read(diffPath) : null
      );
      console.log(JSON.stringify({ file, ...result }));
    } catch (error) {
      console.log(JSON.stringify({ file, diagnosticError: error.message }));
    }
  }
  if (files.length > MAX_COMPARISONS)
    console.log(JSON.stringify({ omittedComparisons: files.length - MAX_COMPARISONS }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  logFailures(
    process.argv.length > 2
      ? process.argv.slice(2)
      : ['apps/web/workspace-test-results', 'apps/web/test-results']
  );

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import bundle from 'playwright-core/lib/utilsBundle';
import { screenshotDiagnostic, MAX_CROP_BASE64_LENGTH } from './log-workspace-screenshot-diffs.mjs';
const { PNG } = bundle;
function png(width, height, color = [80, 80, 80, 255]) {
  const result = new PNG({ width, height });
  for (let i = 0; i < result.data.length; i += 4) result.data.set(color, i);
  return result;
}
function pixel(image, x, y, color) {
  image.data.set(color, (y * image.width + x) * 4);
}
test('reports exact raw changes and the thresholded red diff region with readable crops', () => {
  const expected = png(20, 20),
    actual = png(20, 20),
    diff = png(20, 20);
  pixel(actual, 4, 5, [255, 255, 255, 255]);
  pixel(actual, 5, 5, [81, 80, 80, 255]);
  pixel(diff, 4, 5, [255, 0, 0, 255]);
  const result = screenshotDiagnostic(expected, actual, diff);
  assert.equal(result.changedPixels, 2);
  assert.deepEqual(result.changedBounds, { x: 4, y: 5, width: 2, height: 1 });
  assert.equal(result.thresholdDiffPixels, 1);
  assert.deepEqual(result.thresholdDiffBounds, { x: 4, y: 5, width: 1, height: 1 });
  for (const name of ['expected', 'actual', 'diff']) {
    const crop = result.crops[name];
    assert.ok(crop.base64.length <= MAX_CROP_BASE64_LENGTH);
    const decoded = PNG.sync.read(Buffer.from(crop.base64, 'base64'));
    assert.equal(decoded.width, crop.width);
    assert.equal(decoded.height, crop.height);
  }
  const actualCrop = PNG.sync.read(Buffer.from(result.crops.actual.base64, 'base64'));
  const i = ((5 - result.crops.actual.y) * actualCrop.width + 4 - result.crops.actual.x) * 4;
  assert.deepEqual([...actualCrop.data.subarray(i, i + 4)], [255, 255, 255, 255]);
});
test('counts changed dimensions without pretending missing pixels match', () => {
  const result = screenshotDiagnostic(png(3, 2), png(4, 2), null);
  assert.equal(result.changedPixels, 2);
  assert.deepEqual(result.changedBounds, { x: 3, y: 0, width: 1, height: 2 });
  assert.equal(result.thresholdDiffPixels, null);
});
test('bounds crop output even when the changed region spans a large screenshot', () => {
  const actual = png(200, 200);
  for (let i = 0; i < actual.data.length; i++)
    actual.data[i] = (i * 113 + Math.floor(i / 17)) % 256;
  const result = screenshotDiagnostic(png(200, 200), actual, null);
  for (const crop of Object.values(result.crops)) {
    assert.ok(crop.width <= 96 && crop.height <= 96);
    assert.ok(crop.omitted || crop.base64.length <= MAX_CROP_BASE64_LENGTH);
  }
});
test('failure logger reads adjacent runner artifacts and emits only bounded diagnostic JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drasil-screenshot-diagnostic-'));
  try {
    const actual = png(20, 20),
      diff = png(20, 20);
    pixel(actual, 7, 9, [0, 255, 0, 255]);
    pixel(diff, 7, 9, [255, 0, 0, 255]);
    for (const [suffix, data] of Object.entries({ actual, expected: png(20, 20), diff }))
      writeFileSync(path.join(dir, `workspace-case-dark-320-${suffix}.png`), PNG.sync.write(data));
    const result = spawnSync(
      process.execPath,
      ['scripts/log-workspace-screenshot-diffs.mjs', dir],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].changedPixels, 1);
    assert.deepEqual(lines[0].thresholdDiffBounds, { x: 7, y: 9, width: 1, height: 1 });
    assert.ok(result.stdout.length < 30_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { EventEmitter } from 'node:events';
import { createCaptchaImageRenderer } from '../../services/captcha/imageRenderer';

// Losing the explicit answer, dimensions, or metadata boundary breaks this test.
it('renders a bounded PNG without embedding the answer as metadata', async () => {
  const png = await createCaptchaImageRenderer().render('A2B3C4');
  expect(Buffer.isBuffer(png)).toBe(true);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(300);
  expect(png.readUInt32BE(20)).toBe(100);
  expect(png.length).toBeLessThanOrEqual(256 * 1024);
  const chunks: string[] = [];
  for (let offset = 8; offset < png.length; ) {
    const size = png.readUInt32BE(offset);
    chunks.push(png.toString('ascii', offset + 4, offset + 8));
    offset += size + 12;
  }
  expect(chunks).not.toEqual(expect.arrayContaining(['tEXt', 'zTXt', 'iTXt']));
});

// A controllable worker boundary makes saturation and hung/native output deterministic.
class ControlledWorker extends EventEmitter {
  static instances: ControlledWorker[] = [];
  jobs = 0;
  terminated = false;
  constructor() {
    super();
    ControlledWorker.instances.push(this);
  }
  postMessage() {
    this.jobs++;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  async terminate() {
    this.terminated = true;
    return 0;
  }
}

function isolatedPool() {
  ControlledWorker.instances = [];
  jest.doMock('node:worker_threads', () => ({ Worker: ControlledWorker }));
  let api: typeof import('../../services/captcha/imageRenderer');
  jest.isolateModules(() => {
    api = require('../../services/captcha/imageRenderer');
  });
  jest.dontMock('node:worker_threads');
  return api!;
}

it('bounds simultaneous renders and rejects oversized output', async () => {
  const { createCaptchaImageRenderer: create, CaptchaImageBusyError } = isolatedPool();
  const renderer = create();
  const other = create();
  const jobs = Array.from({ length: 22 }, (_, index) =>
    (index % 2 ? renderer : other).render('A2B3C4').catch((error: unknown) => error)
  );
  await expect(renderer.render('A2B3C4')).rejects.toBeInstanceOf(CaptchaImageBusyError);
  expect(ControlledWorker.instances).toHaveLength(2);
  expect(ControlledWorker.instances.reduce((n, worker) => n + worker.jobs, 0)).toBe(2);
  for (let index = 0; index < 22; index++) {
    ControlledWorker.instances[index % 2].emit('message', Buffer.alloc(256 * 1024 + 1));
  }
  for (const result of await Promise.all(jobs))
    expect(result).toMatchObject({ code: 'CAPTCHA_IMAGE_INVALID_OUTPUT' });
  // Completed jobs free capacity instead of leaving a permanently saturated pool.
  const next = renderer.render('A2B3C4').catch((error: unknown) => error);
  ControlledWorker.instances
    .find((worker) => worker.jobs === 12)
    ?.emit('message', Buffer.alloc(256 * 1024 + 1));
  expect(await next).toMatchObject({ code: 'CAPTCHA_IMAGE_INVALID_OUTPUT' });
});

it('replaces a worker after the five-second deadline and resumes queued work', async () => {
  jest.useFakeTimers();
  try {
    const { createCaptchaImageRenderer: create } = isolatedPool();
    const renderer = create();
    const first = renderer.render('A2B3C4').catch((error: unknown) => error);
    const second = renderer.render('A2B3C4').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(2500);
    const queued = renderer.render('A2B3C4').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(2500);
    expect(await first).toMatchObject({ code: 'CAPTCHA_IMAGE_TIMEOUT' });
    expect(await second).toMatchObject({ code: 'CAPTCHA_IMAGE_TIMEOUT' });
    expect(ControlledWorker.instances.slice(0, 2).every((worker) => worker.terminated)).toBe(true);
    const replacement = ControlledWorker.instances[2];
    expect(replacement.jobs).toBe(1);
    replacement.emit('message', Buffer.alloc(256 * 1024 + 1));
    expect(await queued).toMatchObject({ code: 'CAPTCHA_IMAGE_INVALID_OUTPUT' });
  } finally {
    jest.useRealTimers();
  }
});

it.each(['', 'ABC', 'A2B3C4D', 'a2b3c4', 'A2B3I4'])(
  'rejects inputs outside the six-character answer alphabet',
  async (answer) => {
    await expect(createCaptchaImageRenderer().render(answer)).rejects.toMatchObject({
      code: 'CAPTCHA_IMAGE_INVALID_ANSWER',
    });
  }
);

it('keeps text legible on dark clients with an opaque background', async () => {
  const { Canvas, loadImage } = await import('skia-canvas');
  const png = await createCaptchaImageRenderer().render('A2B3C4');
  const canvas = new Canvas(300, 100);
  const context = canvas.getContext('2d');
  context.drawImage(await loadImage(png), 0, 0);
  const pixels = context.getImageData(0, 0, 300, 100).data;
  expect(pixels.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true);
});

it('expires queued jobs within five seconds of enqueue', async () => {
  jest.useFakeTimers();
  try {
    const { createCaptchaImageRenderer: create } = isolatedPool();
    const settled: unknown[] = [];
    for (let index = 0; index < 22; index++) {
      void create()
        .render('A2B3C4')
        .catch((error: unknown) => {
          settled.push(error);
        });
    }
    await jest.advanceTimersByTimeAsync(5000);
    expect(settled).toHaveLength(22);
    for (const result of settled) expect(result).toMatchObject({ code: 'CAPTCHA_IMAGE_TIMEOUT' });
  } finally {
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  }
});

it('preserves the enqueue deadline when a queued job starts', async () => {
  jest.useFakeTimers();
  try {
    const { createCaptchaImageRenderer: create } = isolatedPool();
    void create()
      .render('A2B3C4')
      .catch(() => undefined);
    void create()
      .render('A2B3C4')
      .catch(() => undefined);
    await jest.advanceTimersByTimeAsync(2500);
    const settled: unknown[] = [];
    void create()
      .render('A2B3C4')
      .catch((error: unknown) => {
        settled.push(error);
      });
    await jest.advanceTimersByTimeAsync(2500);
    expect(ControlledWorker.instances[2].jobs).toBe(1);
    await jest.advanceTimersByTimeAsync(2499);
    expect(settled).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ code: 'CAPTCHA_IMAGE_TIMEOUT' });
  } finally {
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  }
});

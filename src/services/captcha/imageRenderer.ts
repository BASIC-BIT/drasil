import { Worker } from 'node:worker_threads';

export interface CaptchaImageRenderer {
  render(answer: string): Promise<Buffer>;
}

type FailureCode =
  | 'CAPTCHA_IMAGE_BUSY'
  | 'CAPTCHA_IMAGE_TIMEOUT'
  | 'CAPTCHA_IMAGE_INVALID_OUTPUT'
  | 'CAPTCHA_IMAGE_INVALID_ANSWER'
  | 'CAPTCHA_IMAGE_RENDER_FAILED';

export class CaptchaImageRenderError extends Error {
  constructor(public readonly code: FailureCode) {
    // Never include worker errors or answers in diagnostics.
    super(code);
    this.name = 'CaptchaImageRenderError';
  }
}

export class CaptchaImageBusyError extends CaptchaImageRenderError {
  constructor() {
    super('CAPTCHA_IMAGE_BUSY');
    this.name = 'CaptchaImageBusyError';
  }
}

// Native drawing runs outside the bot event loop. Only explicit text is drawn.
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { Captcha, resolveImage } = require(workerData.captchaModule);
const { FontLibrary } = require(workerData.skiaModule);
if (!FontLibrary.has('Liberation Sans')) throw new Error('CAPTCHA font unavailable');
const background = resolveImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="white"/></svg>'));
parentPort.on('message', async (answer) => {
  try {
    const captcha = new Captcha(300, 100, 6);
    captcha.drawImage(await background);
    captcha.addDecoy({ total: 20, size: 18, opacity: 0.25, color: '#64748b', font: 'Liberation Sans' });
    captcha.drawCaptcha({ text: answer, size: 48, color: '#172554', font: 'Liberation Sans', rotate: 10, skew: true });
    captcha.drawTrace({ size: 2, opacity: 0.6, color: '#64748b' });
    parentPort.postMessage(await captcha.png);
  } catch {
    parentPort.postMessage(null);
  }
});
`;

function checkedPng(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength > 256 * 1024) {
    throw new CaptchaImageRenderError('CAPTCHA_IMAGE_INVALID_OUTPUT');
  }
  const png = Buffer.from(value);
  const invalid = (): never => {
    throw new CaptchaImageRenderError('CAPTCHA_IMAGE_INVALID_OUTPUT');
  };
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== 300 ||
    png.readUInt32BE(20) !== 100
  )
    invalid();
  let offset = 8;
  let hasImageData = false;
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset);
    const kind = png.toString('ascii', offset + 4, offset + 8);
    if (size > png.length - offset - 12 || ['tEXt', 'zTXt', 'iTXt'].includes(kind)) invalid();
    if (kind === 'IDAT') hasImageData = true;
    offset += size + 12;
    if (kind === 'IEND') {
      if (size !== 0 || offset !== png.length || !hasImageData) invalid();
      return png;
    }
  }
  return invalid();
}

type Job = {
  answer: string;
  expiresAt: number;
  deadline: ReturnType<typeof setTimeout>;
  resolve: (png: Buffer) => void;
  reject: (error: CaptchaImageRenderError) => void;
};

class WorkerPool implements CaptchaImageRenderer {
  private readonly workers = new Set<Worker>();
  private readonly idle: Worker[] = [];
  private readonly running = new Map<Worker, Job>();
  private readonly retiring = new Set<Worker>();
  private readonly queue: Job[] = [];

  render(answer: string): Promise<Buffer> {
    if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(answer)) {
      return Promise.reject(new CaptchaImageRenderError('CAPTCHA_IMAGE_INVALID_ANSWER'));
    }
    if (this.workers.size === 2 && this.idle.length === 0 && this.queue.length >= 20) {
      return Promise.reject(new CaptchaImageBusyError());
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        answer,
        resolve,
        reject,
        expiresAt: Date.now() + 5000,
        deadline: setTimeout(() => this.expire(job), 5000),
      };
      this.queue.push(job);
      this.drain();
    });
  }

  private createWorker(): Worker {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        captchaModule: require.resolve('captcha-canvas'),
        skiaModule: require.resolve('skia-canvas'),
      },
      env: { ...process.env, SKIA_CANVAS_THREADS: '1' },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    this.workers.add(worker);
    worker.on('message', (value: unknown) => this.complete(worker, value));
    worker.on('error', () => this.retire(worker, 'CAPTCHA_IMAGE_RENDER_FAILED'));
    worker.on('exit', () => this.retire(worker, 'CAPTCHA_IMAGE_RENDER_FAILED'));
    return worker;
  }

  private drain(): void {
    while (this.queue.length > 0 && (this.idle.length > 0 || this.workers.size < 2)) {
      const job = this.queue.shift();
      if (!job) return;
      if (job.expiresAt <= Date.now()) {
        clearTimeout(job.deadline);
        job.reject(new CaptchaImageRenderError('CAPTCHA_IMAGE_TIMEOUT'));
        continue;
      }
      let worker: Worker;
      try {
        worker = this.idle.pop() ?? this.createWorker();
      } catch {
        clearTimeout(job.deadline);
        job.reject(new CaptchaImageRenderError('CAPTCHA_IMAGE_RENDER_FAILED'));
        continue;
      }
      worker.ref();
      this.running.set(worker, job);
      try {
        worker.postMessage(job.answer);
      } catch {
        this.retire(worker, 'CAPTCHA_IMAGE_RENDER_FAILED');
      }
    }
  }

  private expire(job: Job): void {
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      clearTimeout(job.deadline);
      job.reject(new CaptchaImageRenderError('CAPTCHA_IMAGE_TIMEOUT'));
      return;
    }
    for (const [worker, running] of this.running) {
      if (running === job) {
        this.retire(worker, 'CAPTCHA_IMAGE_TIMEOUT');
        return;
      }
    }
  }

  private complete(worker: Worker, value: unknown): void {
    const running = this.running.get(worker);
    if (!running || this.retiring.has(worker)) return;
    if (running.expiresAt <= Date.now()) {
      this.retire(worker, 'CAPTCHA_IMAGE_TIMEOUT');
      return;
    }
    clearTimeout(running.deadline);
    this.running.delete(worker);
    try {
      running.resolve(checkedPng(value));
    } catch {
      running.reject(new CaptchaImageRenderError('CAPTCHA_IMAGE_INVALID_OUTPUT'));
    }
    this.idle.push(worker);
    worker.unref();
    this.drain();
  }

  private retire(worker: Worker, code: FailureCode): void {
    if (!this.workers.has(worker) || this.retiring.has(worker)) return;
    this.retiring.add(worker);
    const running = this.running.get(worker);
    if (running) {
      clearTimeout(running.deadline);
      this.running.delete(worker);
      running.reject(new CaptchaImageRenderError(code));
    }
    const idleIndex = this.idle.indexOf(worker);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    // Keep the slot occupied until native execution actually stops.
    void worker.terminate().finally(() => {
      this.workers.delete(worker);
      this.retiring.delete(worker);
      this.drain();
    });
  }
}

// All consumers share the process-wide two-worker / twenty-waiter budget.
const renderer: CaptchaImageRenderer = new WorkerPool();
export function createCaptchaImageRenderer(): CaptchaImageRenderer {
  return renderer;
}

/** Load native dependencies and fonts without starting workers or rendering a challenge. */
export function isCaptchaImageRendererReady(): boolean {
  try {
    require('captcha-canvas');
    const { FontLibrary } = require('skia-canvas');
    return FontLibrary.has('Liberation Sans') === true;
  } catch {
    return false;
  }
}

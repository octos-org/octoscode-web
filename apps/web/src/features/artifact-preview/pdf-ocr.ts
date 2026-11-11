import { staticAssetDirectory } from "./static-assets.ts";

export type OcrLanguage = "eng" | "chi_sim+eng";
export type OcrFailure = "unavailable" | "timeout" | "failed" | "cancelled";
export type OcrPhase = "preparing" | "recognizing";
export interface OcrResult {
  readonly text: string;
  readonly confidence: number;
}

export class OcrError extends Error {
  constructor(
    readonly failure: OcrFailure,
    detail?: string,
  ) {
    super(detail ?? failure);
  }
}

const PROBE_TIMEOUT_MS = 10_000;
// The engine and its language data are up to 8 MB on first use.
const PREPARE_TIMEOUT_MS = 90_000;
const RECOGNIZE_TIMEOUT_MS = 60_000;
const IDLE_MS = 60_000;
// Measured in T-0567: clean scans read 90–95, a photo or the wrong language
// 24–35, an over-enlarged scan 68–72 with a fifth of its characters wrong.
const RELIABLE_CONFIDENCE = 80;
const READABLE_CONFIDENCE = 40;

type Progress = (phase: OcrPhase, progress: number) => void;
interface Job {
  resolve(data: unknown): void;
  reject(error: OcrError): void;
  progress: Progress;
}

/**
 * One Tesseract worker for one open PDF, driven through worker.min.js's job
 * protocol directly: tesseract.js's createWorker() has no handle on a worker
 * that never finishes loading (it hangs where WebAssembly is blocked), and its
 * terminate() leaves a running job pending forever. Here every cancel, timeout
 * and idle minute ends the thread and settles the job. Nothing is cached: no
 * IndexedDB, no blob worker, no CDN fallback.
 */
export class PdfOcr {
  #worker: Worker | null = null;
  #ready: Promise<void> | null = null;
  #language: OcrLanguage | null = null;
  #generation = 0;
  #jobs = new Map<number, Job>();
  #nextJob = 0;
  #idle: ReturnType<typeof setTimeout> | undefined;

  async recognize(
    image: Blob,
    language: OcrLanguage,
    progress: Progress,
    signal: AbortSignal,
  ): Promise<OcrResult> {
    if (signal.aborted) throw new OcrError("cancelled");
    clearTimeout(this.#idle);
    if (this.#language !== language) this.dispose();
    try {
      this.#language = language;
      this.#ready ??= this.#start(language, progress);
      await bounded(this.#ready, PREPARE_TIMEOUT_MS, signal);
      const bytes = new Uint8Array(await image.arrayBuffer());
      const data = (await bounded(
        this.#send(
          "recognize",
          { image: bytes, options: {}, output: { text: true } },
          progress,
          [bytes.buffer],
        ),
        RECOGNIZE_TIMEOUT_MS,
        signal,
      )) as { text?: unknown; confidence?: unknown };
      this.#idle = setTimeout(() => this.dispose(), IDLE_MS);
      return {
        text: typeof data.text === "string" ? tidy(data.text) : "",
        confidence:
          typeof data.confidence === "number" ? Math.round(data.confidence) : 0,
      };
    } catch (error) {
      this.dispose();
      throw error instanceof OcrError
        ? error
        : new OcrError("failed", String(error));
    }
  }

  dispose(): void {
    clearTimeout(this.#idle);
    this.#generation += 1;
    this.#worker?.terminate();
    this.#worker = null;
    this.#ready = null;
    this.#language = null;
    this.#fail(new OcrError("cancelled"));
  }

  async #start(language: OcrLanguage, progress: Progress): Promise<void> {
    const generation = this.#generation;
    const directory = staticAssetDirectory("ocr");
    if (!(await allowsWebAssembly(directory)))
      throw new OcrError("unavailable");
    if (generation !== this.#generation) throw new OcrError("cancelled");
    const worker = new Worker(`${directory}worker.min.js`);
    this.#worker = worker;
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) =>
      this.#receive(data);
    // A script the server does not serve leaves no recognizer to talk to.
    worker.onerror = (event) => {
      event.preventDefault();
      this.#fail(new OcrError("unavailable"));
    };
    const core = `${directory}tesseract-core-simd-lstm.js`;
    await this.#send(
      "load",
      { options: { lstmOnly: true, corePath: core, logging: false } },
      progress,
    );
    await this.#send(
      "loadLanguage",
      {
        langs: language,
        options: {
          langPath: directory,
          cacheMethod: "none",
          gzip: true,
          lstmOnly: true,
        },
      },
      progress,
    );
    await this.#send(
      "initialize",
      { langs: language, oem: 1, config: {} },
      progress,
    );
  }

  #send(
    action: string,
    payload: object,
    progress: Progress,
    transfer: Transferable[] = [],
  ): Promise<unknown> {
    const worker = this.#worker;
    if (!worker) return Promise.reject(new OcrError("cancelled"));
    const jobId = ++this.#nextJob;
    return new Promise((resolve, reject) => {
      this.#jobs.set(jobId, { resolve, reject, progress });
      worker.postMessage(
        { workerId: "octoscode", jobId, action, payload },
        transfer,
      );
    });
  }

  #receive({ jobId, status, data }: WorkerMessage): void {
    const job = typeof jobId === "number" ? this.#jobs.get(jobId) : undefined;
    if (!job) return;
    if (status === "progress") {
      const update = data as { status?: unknown; progress?: unknown };
      job.progress(
        update.status === "recognizing text" ? "recognizing" : "preparing",
        typeof update.progress === "number" ? update.progress : 0,
      );
      return;
    }
    this.#jobs.delete(jobId as number);
    if (status === "resolve") job.resolve(data);
    else job.reject(new OcrError("failed", String(data)));
  }

  #fail(error: OcrError): void {
    const jobs = [...this.#jobs.values()];
    this.#jobs.clear();
    for (const job of jobs) job.reject(error);
  }
}

interface WorkerMessage {
  jobId?: unknown;
  status?: unknown;
  data?: unknown;
}

/** How much of a result to trust; an unreadable page is not a page without text. */
export function ocrReading(
  result: OcrResult,
): "reliable" | "uncertain" | "unreadable" {
  if (!result.text || result.confidence < READABLE_CONFIDENCE)
    return "unreadable";
  return result.confidence < RELIABLE_CONFIDENCE ? "uncertain" : "reliable";
}

// Tesseract separates Chinese characters with spaces.
const CJK = "\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef";
const CJK_GAP = new RegExp(`(?<=[${CJK}])[ \\t]+(?=[${CJK}])`, "gu");

function tidy(text: string): string {
  return text
    .replace(CJK_GAP, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** probe.js runs under the OCR directory's policy, which must allow WebAssembly. */
function allowsWebAssembly(directory: string): Promise<boolean> {
  return new Promise((resolve) => {
    let probe: Worker;
    try {
      probe = new Worker(`${directory}probe.js`);
    } catch {
      resolve(false);
      return;
    }
    const finish = (allowed: boolean) => {
      clearTimeout(timer);
      probe.terminate();
      resolve(allowed);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    probe.onmessage = ({ data }: MessageEvent<unknown>) =>
      finish(data === true);
    probe.onerror = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}

function bounded<T>(
  work: Promise<T>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      finish();
    };
    const cancel = () => settle(() => reject(new OcrError("cancelled")));
    const timer = setTimeout(
      () => settle(() => reject(new OcrError("timeout"))),
      milliseconds,
    );
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    work.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

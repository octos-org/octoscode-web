interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PreviewWorkerMessage {
  requestId: number;
  type: string;
  [key: string]: unknown;
}

/** One same-origin worker with bounded waits and no stale late replies. */
export class PreviewWorkerClient {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private worker: Worker) {
    worker.onmessage = (event: MessageEvent<PreviewWorkerMessage>) => {
      const message = event.data;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.type === "error") {
        pending.reject(new Error(String(message.error ?? "Preview failed")));
      } else {
        pending.resolve(message);
      }
    };
    worker.onerror = () => this.destroy(new Error("Preview worker failed"));
  }

  request<T extends PreviewWorkerMessage>(
    message: Omit<PreviewWorkerMessage, "requestId">,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.worker.terminate();
        reject(new Error("Preview timed out"));
      }, 30_000);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.worker.postMessage({ ...message, requestId }, transfer);
    });
  }

  destroy(reason = new Error("Preview closed")) {
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

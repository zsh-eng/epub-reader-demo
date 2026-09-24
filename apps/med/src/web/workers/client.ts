import type { FileDiffMetadata } from "@pierre/diffs";

/** Keep at most one parse running; terminate work superseded by a newer comparison. */
export function createPatchParser() {
  let worker: Worker | null = null;
  let sequence = 0;
  let closed = false;
  let pending: {
    id: number;
    resolve(files: FileDiffMetadata[]): void;
    reject(error: Error): void;
  } | null = null;
  const createWorker = () => {
    const next = new Worker(new URL("./patch.ts", import.meta.url), { type: "module" });
    next.onmessage = (
      event: MessageEvent<{ id: number; files?: FileDiffMetadata[]; error?: string }>,
    ) => {
      if (!pending || event.data.id !== pending.id) return;
      const request = pending;
      pending = null;
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.files ?? []);
    };
    next.onerror = () => {
      pending?.reject(new Error("The patch parser stopped. Refresh to try again."));
      pending = null;
      next.terminate();
      if (worker === next) worker = null;
    };
    return next;
  };
  return {
    parse(patch: string): Promise<FileDiffMetadata[]> {
      if (closed) return Promise.reject(new Error("Review closed"));
      if (pending) {
        pending.reject(new DOMException("A newer review replaced this parse.", "AbortError"));
        pending = null;
        worker?.terminate();
        worker = null;
      }
      worker ??= createWorker();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker?.postMessage({ id, patch });
      });
    },
    dispose() {
      closed = true;
      worker?.terminate();
      pending?.reject(new Error("Review closed"));
      pending = null;
      worker = null;
    },
  };
}

/** Elapsed intervals, not CPU samples. Nested/overlapping spans are intentional. */
export function createTrace(enabled: boolean, nativeTiming = false) {
  const origin = performance.now();
  const native = { putCalls: 0, putMs: 0 };
  let restoreNative = () => {};
  const spans: { name: string; start: number; end: number }[] = [];
  function begin(name: string) {
    const start = performance.now() - origin;
    return () => {
      if (enabled) spans.push({ name, start, end: performance.now() - origin });
    };
  }
  function instrument(db: any) {
    if (!enabled) return;
    if (nativeTiming) {
      const originalPut = window.IDBObjectStore.prototype.put;
      window.IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const start = performance.now();
        try {
          return originalPut.apply(this, args);
        } finally {
          native.putCalls++;
          native.putMs += performance.now() - start;
        }
      };
      restoreNative = () => {
        window.IDBObjectStore.prototype.put = originalPut;
      };
    }
    // Dexie table instances can be recreated inside transactions. Wrap the prototype.
    const proto = db.Table.prototype;
    for (const method of ["bulkPut", "count"]) {
      const original = proto[method];
      proto[method] = function (...args: any[]) {
        const end = begin(method === "count" ? "outbox-count" : "bulk-put");
        try {
          return original.apply(this, args).finally(end);
        } catch (error) {
          end();
          throw error;
        }
      };
    }
    const transaction = db.transaction;
    db.transaction = function (...args: any[]) {
      const endStart = begin("transaction-start");
      const callback = args.pop();
      let endCommit: (() => void) | undefined;
      args.push(function (this: unknown, ...inner: any[]) {
        endStart();
        return Promise.resolve(callback.apply(this, inner)).then((value) => {
          endCommit = begin("transaction-commit");
          return value;
        });
      });
      return transaction.apply(this, args).finally(() => endCommit?.());
    };
  }
  return { begin, instrument, spans, native, dispose: () => restoreNative() };
}

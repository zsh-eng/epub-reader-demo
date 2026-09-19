// One lock covers local writes, sync and account reset. Web Locks serialize tabs.
let tail: Promise<unknown> = Promise.resolve();
export function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  const run = () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("spaced-sync-v3", work)
      : work();
  const result = tail.then(run, run);
  tail = result.catch(() => {});
  return result;
}

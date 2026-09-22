// Short local transactions only. Never hold this lock across a network request.
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

// Only network sync runs serialize with each other; local review writes proceed.
export function withNetworkSyncLock<T>(work: () => Promise<T>): Promise<T> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("spaced-network-sync-v3", work)
    : work();
}

import Dexie from "dexie";

/** Benchmark-only interceptor; the library still owns its apply transaction. */
export function instrumentOutbox(
  db: any,
  fast: boolean,
  metrics: { outboxChecks: number; outboxGets: number },
) {
  const bulkGet = db._sync_outbox.bulkGet.bind(db._sync_outbox);
  db._sync_outbox.bulkGet = async (keys: any[]) => {
    if (fast) {
      if (
        !Dexie.currentTransaction ||
        Dexie.currentTransaction.mode !== "readwrite"
      )
        throw Error("Outbox check must share the apply transaction");
      metrics.outboxChecks++;
      if ((await db._sync_outbox.count()) === 0)
        return keys.map(() => undefined);
    }
    metrics.outboxGets += keys.length;
    return bulkGet(keys);
  };
}

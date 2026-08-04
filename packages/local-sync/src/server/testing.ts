import { compareSyncVersions } from "../core/index.js";
import type {
  SequencedSyncRecord,
  SyncPayload,
  SyncRecord,
} from "../core/index.js";
import type {
  ServerStoragePushOutcome,
  ServerSyncRow,
  ServerSyncScan,
  ServerSyncStorage,
  SyncNamespace,
} from "./index.js";

/** Deterministic latest-state bag of rows for server behavior tests. */
export class InMemoryServerSyncStorage<
  TPayload = SyncPayload,
> implements ServerSyncStorage<TPayload> {
  private readonly rows = new Map<string, ServerSyncRow<TPayload>>();
  private nextServerSeq = 1;

  applyLww(
    namespace: SyncNamespace,
    records: readonly SyncRecord<TPayload>[],
  ): Promise<readonly ServerStoragePushOutcome<TPayload>[]> {
    const outcomes = records.map((candidate) => {
      const key = recordKey(namespace, candidate.tableName, candidate.recordId);
      const current = this.rows.get(key);

      if (
        current !== undefined &&
        compareSyncVersions(candidate, current) <= 0
      ) {
        return { accepted: false, winner: current };
      }

      if (!Number.isSafeInteger(this.nextServerSeq)) {
        throw new Error(
          "Server sequence exceeds JavaScript's safe integer range",
        );
      }

      const winner = createServerRow(namespace, candidate, this.nextServerSeq);
      this.nextServerSeq += 1;
      this.rows.set(key, winner);
      return { accepted: true, winner };
    });

    return Promise.resolve(outcomes);
  }

  scan(query: ServerSyncScan): Promise<readonly ServerSyncRow<TPayload>[]> {
    const rows = [...this.rows.values()]
      .filter((row) => {
        if (row.appName !== query.appName || row.userId !== query.userId) {
          return false;
        }
        if (row.serverSeq <= query.cursor) {
          return false;
        }
        if (
          query.tableName !== undefined &&
          row.tableName !== query.tableName
        ) {
          return false;
        }
        if (query.scopeId !== undefined && row.scopeId !== query.scopeId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.serverSeq - right.serverSeq)
      .slice(0, query.limit);

    return Promise.resolve(rows);
  }
}

function recordKey(
  namespace: SyncNamespace,
  tableName: string,
  recordId: string,
): string {
  return JSON.stringify([
    namespace.appName,
    namespace.userId,
    tableName,
    recordId,
  ]);
}

function createServerRow<TPayload>(
  namespace: SyncNamespace,
  record: SyncRecord<TPayload>,
  serverSeq: number,
): ServerSyncRow<TPayload> {
  const sequenced: SequencedSyncRecord<TPayload> =
    record.operation === "put"
      ? { ...record, operation: "put", serverSeq }
      : { ...record, operation: "delete", serverSeq };

  return {
    ...sequenced,
    appName: namespace.appName,
    userId: namespace.userId,
  };
}

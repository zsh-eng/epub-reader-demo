import type { HybridLogicalClock } from "../../client/index.js";
import type {
  SequencedSyncRecord,
  SyncCursor,
  SyncPayload,
  SyncRecord,
  SyncTablePolicy,
} from "../../core/index.js";
import type {
  InferTableRow,
  SyncSchemaBuilder,
  TableBuilder,
  TableDefinitions,
} from "../../schema/index.js";
import type { SqlDriver } from "./index.js";
import {
  DEFAULT_SYNC_CURSOR_KEY,
  readSyncCursor,
  writeSyncCursor,
} from "./cursors.js";
import { deleteLocalRows, putLocalRows } from "./local-writes.js";
import {
  type PendingChangesOptions,
  readPendingChanges,
} from "./pending-changes.js";
import {
  type PushOutcomeLike,
  type RemoteApplyOptions,
  type ServerRecordApplyResult,
  applyRemoteRecords,
  reconcilePushOutcomeRecords,
} from "./remote-apply.js";
import { getSyncedTable } from "./sync-record.js";

export { DEFAULT_SYNC_CURSOR_KEY } from "./cursors.js";
export {
  DEFAULT_PENDING_CHANGES_LIMIT,
  MAX_PENDING_CHANGES_LIMIT,
  type PendingChangesOptions,
} from "./pending-changes.js";
export type {
  AffectedSyncTarget,
  PushOutcomeLike,
  RemoteApplyOptions,
  ServerRecordApplyResult,
} from "./remote-apply.js";

type SyncedTableName<TTables extends TableDefinitions> = {
  [TName in keyof TTables]: TTables[TName] extends TableBuilder<
    infer _TColumns,
    infer TSync
  >
    ? TSync extends SyncTablePolicy
      ? TName
      : never
    : never;
}[keyof TTables] &
  string;

type TableRow<
  TTables extends TableDefinitions,
  TName extends keyof TTables,
> = InferTableRow<TTables[TName]>;

export interface SqliteSyncClientOptions<TTables extends TableDefinitions> {
  readonly schema: SyncSchemaBuilder<TTables>;
  readonly driver: SqlDriver;
  readonly clock: HybridLogicalClock;
}

/** Explicit local writes and server reconciliation over generated SQLite tables. */
export class SqliteSyncClient<TTables extends TableDefinitions> {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: SqliteSyncClientOptions<TTables>) {}

  put<TName extends SyncedTableName<TTables>>(
    tableName: TName,
    row: TableRow<TTables, TName>,
  ): Promise<SyncRecord<TableRow<TTables, TName>>> {
    return this.enqueue(async () => {
      const table = getSyncedTable(this.options.schema.meta, tableName);
      const records = await putLocalRows(
        this.options.driver,
        this.options.clock,
        tableName,
        table,
        [row],
      );
      return records[0] as SyncRecord<TableRow<TTables, TName>>;
    });
  }

  putMany<TName extends SyncedTableName<TTables>>(
    tableName: TName,
    rows: readonly TableRow<TTables, TName>[],
  ): Promise<readonly SyncRecord<TableRow<TTables, TName>>[]> {
    return this.enqueue(async () => {
      const table = getSyncedTable(this.options.schema.meta, tableName);
      const records = await putLocalRows(
        this.options.driver,
        this.options.clock,
        tableName,
        table,
        rows,
      );
      return records as readonly SyncRecord<TableRow<TTables, TName>>[];
    });
  }

  delete<TName extends SyncedTableName<TTables>>(
    tableName: TName,
    recordId: string,
  ): Promise<SyncRecord<TableRow<TTables, TName>>> {
    return this.enqueue(async () => {
      const table = getSyncedTable(this.options.schema.meta, tableName);
      const records = await deleteLocalRows(
        this.options.driver,
        this.options.clock,
        tableName,
        table,
        [recordId],
      );
      return records[0] as SyncRecord<TableRow<TTables, TName>>;
    });
  }

  deleteMany<TName extends SyncedTableName<TTables>>(
    tableName: TName,
    recordIds: readonly string[],
  ): Promise<readonly SyncRecord<TableRow<TTables, TName>>[]> {
    return this.enqueue(async () => {
      const table = getSyncedTable(this.options.schema.meta, tableName);
      const records = await deleteLocalRows(
        this.options.driver,
        this.options.clock,
        tableName,
        table,
        recordIds,
      );
      return records as readonly SyncRecord<TableRow<TTables, TName>>[];
    });
  }

  getPendingChanges(
    options: PendingChangesOptions = {},
  ): Promise<readonly SyncRecord<SyncPayload>[]> {
    return this.enqueue(() =>
      readPendingChanges(
        this.options.driver,
        this.options.schema.meta,
        options,
      ),
    );
  }

  applyRemote(
    records: readonly SequencedSyncRecord<SyncPayload>[],
    options: RemoteApplyOptions = {},
  ): Promise<ServerRecordApplyResult> {
    return this.enqueue(() =>
      applyRemoteRecords(
        this.options.driver,
        this.options.clock,
        this.options.schema.meta,
        records,
        options,
      ),
    );
  }

  /** Reconciles the current winners returned for a pushed pending batch. */
  reconcilePushOutcomes(
    outcomes: readonly PushOutcomeLike[],
  ): Promise<ServerRecordApplyResult> {
    return this.enqueue(() =>
      reconcilePushOutcomeRecords(
        this.options.driver,
        this.options.clock,
        this.options.schema.meta,
        outcomes,
      ),
    );
  }

  getCursor(cursorKey = DEFAULT_SYNC_CURSOR_KEY): Promise<SyncCursor> {
    return this.enqueue(() => readSyncCursor(this.options.driver, cursorKey));
  }

  setCursor(
    cursor: SyncCursor,
    cursorKey = DEFAULT_SYNC_CURSOR_KEY,
  ): Promise<void> {
    return this.enqueue(() =>
      writeSyncCursor(this.options.driver, cursorKey, cursor),
    );
  }

  private enqueue<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createSqliteSyncClient<TTables extends TableDefinitions>(
  options: SqliteSyncClientOptions<TTables>,
): SqliteSyncClient<TTables> {
  return new SqliteSyncClient(options);
}

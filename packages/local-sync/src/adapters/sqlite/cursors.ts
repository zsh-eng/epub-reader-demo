import { INITIAL_SYNC_CURSOR, type SyncCursor } from "../../core/index.js";
import type { SqlExecutor } from "./index.js";

export const DEFAULT_SYNC_CURSOR_KEY = "app";

interface SyncCursorRow {
  readonly server_seq: number;
}

export async function readSyncCursor(
  executor: SqlExecutor,
  cursorKey: string,
): Promise<SyncCursor> {
  const rows = await executor.all<SyncCursorRow>(
    `select server_seq
     from sync_cursors
     where cursor_key = ?`,
    [cursorKey],
  );
  return rows[0]?.server_seq ?? INITIAL_SYNC_CURSOR;
}

/** Advances a cursor monotonically; replaying an older page is a no-op. */
export async function writeSyncCursor(
  executor: SqlExecutor,
  cursorKey: string,
  cursor: SyncCursor,
): Promise<void> {
  await executor.run(
    `insert into sync_cursors (cursor_key, server_seq)
     values (?, ?)
     on conflict (cursor_key) do update set
       server_seq = excluded.server_seq
     where excluded.server_seq > sync_cursors.server_seq`,
    [cursorKey, cursor],
  );
}

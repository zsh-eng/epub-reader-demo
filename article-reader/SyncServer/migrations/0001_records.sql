-- Apply only to Arctic's separate D1 database, never to Reader's database.
CREATE TABLE IF NOT EXISTS sync_records (
  server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  schema_version INTEGER NOT NULL, hlc_wall_time_ms INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL, device_id TEXT NOT NULL, is_deleted INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_records_user_key_unique ON sync_records (user_id, key);
CREATE INDEX IF NOT EXISTS sync_records_user_seq_idx ON sync_records (user_id, server_seq);

export const D1_SYNC_ROWS_TABLE = "local_sync_rows";

export const D1_APPLY_LWW_BATCH_SQL = `
  INSERT INTO ${D1_SYNC_ROWS_TABLE} (
    app_name,
    user_id,
    table_name,
    record_id,
    scope_id,
    hlc_wall_time_ms,
    hlc_counter,
    device_id,
    schema_version,
    is_deleted,
    payload
  )
  SELECT
    ?,
    ?,
    json_extract(value, '$.tableName'),
    json_extract(value, '$.recordId'),
    json_extract(value, '$.scopeId'),
    json_extract(value, '$.hlc.wallTimeMs'),
    json_extract(value, '$.hlc.counter'),
    json_extract(value, '$.deviceId'),
    json_extract(value, '$.schemaVersion'),
    CASE json_extract(value, '$.operation')
      WHEN 'delete' THEN 1
      ELSE 0
    END,
    json_extract(value, '$.payload')
  FROM json_each(?)
  WHERE true
  ON CONFLICT (app_name, user_id, table_name, record_id) DO UPDATE SET
    server_seq = excluded.server_seq,
    scope_id = excluded.scope_id,
    hlc_wall_time_ms = excluded.hlc_wall_time_ms,
    hlc_counter = excluded.hlc_counter,
    device_id = excluded.device_id,
    schema_version = excluded.schema_version,
    is_deleted = excluded.is_deleted,
    payload = excluded.payload
  WHERE
    excluded.hlc_wall_time_ms > ${D1_SYNC_ROWS_TABLE}.hlc_wall_time_ms
    OR (
      excluded.hlc_wall_time_ms = ${D1_SYNC_ROWS_TABLE}.hlc_wall_time_ms
      AND excluded.hlc_counter > ${D1_SYNC_ROWS_TABLE}.hlc_counter
    )
    OR (
      excluded.hlc_wall_time_ms = ${D1_SYNC_ROWS_TABLE}.hlc_wall_time_ms
      AND excluded.hlc_counter = ${D1_SYNC_ROWS_TABLE}.hlc_counter
      AND excluded.device_id > ${D1_SYNC_ROWS_TABLE}.device_id
    )
  RETURNING *
`;

export const D1_READ_BATCH_WINNERS_SQL = `
  WITH requested(table_name, record_id) AS (
    SELECT
      json_extract(value, '$.tableName'),
      json_extract(value, '$.recordId')
    FROM json_each(?)
  )
  SELECT stored.*
  FROM requested
  CROSS JOIN ${D1_SYNC_ROWS_TABLE} AS stored
    INDEXED BY local_sync_rows_logical_key_idx
  WHERE stored.app_name = ?
    AND stored.user_id = ?
    AND stored.table_name = requested.table_name
    AND stored.record_id = requested.record_id
`;

export const D1_SCAN_APP_SQL = `
  SELECT * FROM ${D1_SYNC_ROWS_TABLE}
  WHERE app_name = ?
    AND user_id = ?
    AND server_seq > ?
  ORDER BY server_seq
  LIMIT ?
`;

export const D1_SCAN_TABLE_SQL = `
  SELECT * FROM ${D1_SYNC_ROWS_TABLE}
  WHERE app_name = ?
    AND user_id = ?
    AND table_name = ?
    AND server_seq > ?
  ORDER BY server_seq
  LIMIT ?
`;

export const D1_SCAN_SCOPE_SQL = `
  SELECT * FROM ${D1_SYNC_ROWS_TABLE}
  WHERE app_name = ?
    AND user_id = ?
    AND table_name = ?
    AND scope_id = ?
    AND server_seq > ?
  ORDER BY server_seq
  LIMIT ?
`;

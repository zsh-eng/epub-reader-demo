CREATE TABLE `local_sync_rows` (
	`server_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_name` text NOT NULL CHECK (length(`app_name`) > 0),
	`user_id` text NOT NULL CHECK (length(`user_id`) > 0),
	`table_name` text NOT NULL CHECK (length(`table_name`) > 0),
	`record_id` text NOT NULL CHECK (length(`record_id`) > 0),
	`scope_id` text,
	`hlc_wall_time_ms` integer NOT NULL CHECK (`hlc_wall_time_ms` >= 0),
	`hlc_counter` integer NOT NULL CHECK (`hlc_counter` >= 0),
	`device_id` text NOT NULL CHECK (length(`device_id`) > 0),
	`schema_version` integer NOT NULL CHECK (`schema_version` > 0),
	`is_deleted` integer NOT NULL CHECK (`is_deleted` IN (0, 1)),
	`payload` text NOT NULL CHECK (json_valid(`payload`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_sync_rows_logical_key_idx`
	ON `local_sync_rows` (`app_name`, `user_id`, `table_name`, `record_id`);
--> statement-breakpoint
CREATE INDEX `local_sync_rows_app_seq_idx`
	ON `local_sync_rows` (`app_name`, `user_id`, `server_seq`);
--> statement-breakpoint
CREATE INDEX `local_sync_rows_table_seq_idx`
	ON `local_sync_rows` (`app_name`, `user_id`, `table_name`, `server_seq`);
--> statement-breakpoint
CREATE INDEX `local_sync_rows_scope_seq_idx`
	ON `local_sync_rows` (`app_name`, `user_id`, `table_name`, `scope_id`, `server_seq`);

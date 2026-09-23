CREATE TABLE `sync_records` (
	`server_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`schema_version` integer NOT NULL,
	`hlc_wall_time_ms` integer NOT NULL,
	`hlc_counter` integer NOT NULL,
	`device_id` text NOT NULL,
	`is_deleted` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_records_user_seq_idx` ON `sync_records` (`user_id`,`server_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_records_user_key_unique` ON `sync_records` (`user_id`,`key`);
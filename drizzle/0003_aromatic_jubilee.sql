CREATE TABLE `reading_progress_log` (
	`server_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_hash` text NOT NULL,
	`device_id` text NOT NULL,
	`spine_index` integer NOT NULL,
	`scroll_progress` real NOT NULL,
	`client_seq` integer NOT NULL,
	`client_timestamp` integer NOT NULL,
	`server_timestamp` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `user_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_progress_log_id_unique` ON `reading_progress_log` (`id`);--> statement-breakpoint
CREATE INDEX `idx_progress_user_book` ON `reading_progress_log` (`user_id`,`file_hash`);--> statement-breakpoint
CREATE INDEX `idx_progress_user_server_seq` ON `reading_progress_log` (`user_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `idx_progress_device_seq` ON `reading_progress_log` (`device_id`,`client_seq`);
CREATE TABLE `file_storage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`file_type` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_files_user_updated` ON `file_storage` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_files_user_content_hash` ON `file_storage` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_content_hash_type_unique` ON `file_storage` (`user_id`,`content_hash`,`file_type`);--> statement-breakpoint
DROP TABLE `books`;--> statement-breakpoint
DROP TABLE `reading_progress_log`;
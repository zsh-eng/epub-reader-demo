CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`file_hash` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`file_size` integer NOT NULL,
	`epub_r2_key` text,
	`cover_r2_key` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_books_user_updated` ON `books` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_file_hash_unique` ON `books` (`user_id`,`file_hash`);
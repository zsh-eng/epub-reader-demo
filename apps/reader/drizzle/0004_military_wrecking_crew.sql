CREATE TABLE `sync_data` (
	`id` text NOT NULL,
	`table_name` text NOT NULL,
	`user_id` text NOT NULL,
	`entity_id` text,
	`hlc` text NOT NULL,
	`device_id` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`server_timestamp` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`table_name`, `user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_pull` ON `sync_data` (`table_name`,`user_id`,`server_timestamp`);--> statement-breakpoint
CREATE INDEX `idx_sync_entity` ON `sync_data` (`table_name`,`user_id`,`entity_id`,`server_timestamp`);
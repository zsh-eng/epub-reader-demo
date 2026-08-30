PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_storage` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`media_type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_file_storage`(
	"id",
	"user_id",
	"r2_key",
	"file_size",
	"media_type",
	"created_at",
	"deleted_at"
)
-- Legacy writes calculated content_hash from the uploaded bytes on the server.
-- Rows with the same user and digest are therefore one opaque file even when
-- the old API assigned different file_type values.
SELECT
	'xxh64:' || lower("content_hash"),
	"user_id",
	"r2_key",
	"file_size",
	"mime_type",
	"created_at",
	"deleted_at"
FROM (
	SELECT
		*,
		row_number() OVER (
			PARTITION BY "user_id", lower("content_hash")
			ORDER BY
				("deleted_at" IS NULL) DESC,
				"updated_at" DESC,
				"created_at" DESC,
				"id" DESC
		) AS "file_rank"
	FROM `file_storage`
)
WHERE "file_rank" = 1;--> statement-breakpoint
DROP TABLE `file_storage`;--> statement-breakpoint
ALTER TABLE `__new_file_storage` RENAME TO `file_storage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `file_storage_user_active_created_idx` ON `file_storage` (`user_id`,`deleted_at`,`created_at`);

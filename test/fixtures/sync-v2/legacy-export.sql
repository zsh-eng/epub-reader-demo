PRAGMA foreign_keys=OFF;
CREATE TABLE `sync_data` (
  `id` text NOT NULL,
  `table_name` text NOT NULL,
  `user_id` text NOT NULL,
  `entity_id` text,
  `hlc` text NOT NULL,
  `device_id` text NOT NULL,
  `is_deleted` integer DEFAULT false NOT NULL,
  `server_timestamp` integer NOT NULL,
  `data` text NOT NULL,
  PRIMARY KEY(`table_name`, `user_id`, `id`)
);
INSERT INTO `sync_data` VALUES (
  'book-1',
  'books',
  'user-1',
  NULL,
  '100-0-device-a',
  'device-a',
  0,
  100,
  '{"title":"First book","author":"Author"}'
);
INSERT INTO `sync_data` VALUES (
  'progress-1',
  'readingProgress',
  'user-1',
  'book-1',
  '101-2-device-b',
  'device-b',
  1,
  101,
  '{"bookId":"book-1","lastRead":101,"createdAt":100,"currentSpineIndex":2,"scrollProgress":35}'
);
INSERT INTO `sync_data` VALUES (
  'note-1',
  'notes',
  'user-2',
  'book-2',
  '102-0-device-c',
  'device-c',
  0,
  102,
  '{"bookId":"book-2","content":"Retained note"}'
);

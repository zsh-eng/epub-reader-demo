import { computeFileId } from "@server/lib/files";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createTestUser, uploadTestFile } from "./helpers";

const MIGRATION_NAME = "0008_new_obadiah_stane.sql";

describe("file storage migration", () => {
  it("converts legacy hashes and merges type-specific duplicates", async () => {
    const user = await createTestUser(
      "file-migration@example.com",
      "testpassword123",
      "File Migration User",
    );
    const sharedContent = new TextEncoder().encode("shared legacy bytes");
    const uniqueContent = new TextEncoder().encode("unique legacy bytes");
    const sharedFileId = await computeFileId(
      sharedContent.buffer as ArrayBuffer,
    );
    const uniqueFileId = await computeFileId(
      uniqueContent.buffer as ArrayBuffer,
    );
    const sharedHash = sharedFileId.slice("xxh64:".length);
    const uniqueHash = uniqueFileId.slice("xxh64:".length);

    await uploadTestFile("legacy/shared-active", sharedContent, "text/plain");
    await uploadTestFile("legacy/shared-deleted", sharedContent, "text/plain");
    await uploadTestFile("legacy/unique", uniqueContent, "text/plain");

    await env.DATABASE.exec(
      "PRAGMA foreign_keys=OFF; DROP TABLE file_storage;",
    );
    await env.DATABASE.prepare(`
      CREATE TABLE file_storage (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        content_hash text NOT NULL,
        file_type text NOT NULL,
        r2_key text NOT NULL,
        file_name text,
        file_size integer NOT NULL,
        mime_type text NOT NULL,
        metadata text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        deleted_at integer,
        FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE cascade
      )
    `).run();
    await env.DATABASE.prepare(`
      CREATE UNIQUE INDEX user_content_hash_type_unique
        ON file_storage (user_id, content_hash, file_type)
    `).run();

    const insertLegacyFile = env.DATABASE.prepare(`
      INSERT INTO file_storage (
        id,
        user_id,
        content_hash,
        file_type,
        r2_key,
        file_size,
        mime_type,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await env.DATABASE.batch([
      insertLegacyFile.bind(
        "legacy-active",
        user.userId,
        sharedHash,
        "cover",
        "legacy/shared-active",
        sharedContent.byteLength,
        "text/plain",
        100,
        100,
        null,
      ),
      insertLegacyFile.bind(
        "legacy-deleted",
        user.userId,
        sharedHash,
        "thumbnail",
        "legacy/shared-deleted",
        sharedContent.byteLength,
        "text/plain",
        200,
        200,
        300,
      ),
      insertLegacyFile.bind(
        "legacy-unique",
        user.userId,
        uniqueHash,
        "epub",
        "legacy/unique",
        uniqueContent.byteLength,
        "application/epub+zip",
        400,
        400,
        null,
      ),
    ]);

    const migration = env.TEST_MIGRATIONS.find(
      (candidate) => candidate.name === MIGRATION_NAME,
    );
    expect(migration).toBeDefined();

    for (const query of migration!.queries) {
      await env.DATABASE.prepare(query).run();
    }

    const rows = await env.DATABASE.prepare(
      `
        SELECT id, user_id, r2_key, file_size, media_type, deleted_at
        FROM file_storage
        WHERE user_id = ?
        ORDER BY id
      `,
    )
      .bind(user.userId)
      .all<{
        id: string;
        user_id: string;
        r2_key: string;
        file_size: number;
        media_type: string;
        deleted_at: number | null;
      }>();

    expect(rows.results).toEqual(
      [
        {
          id: sharedFileId,
          user_id: user.userId,
          r2_key: "legacy/shared-active",
          file_size: sharedContent.byteLength,
          media_type: "text/plain",
          deleted_at: null,
        },
        {
          id: uniqueFileId,
          user_id: user.userId,
          r2_key: "legacy/unique",
          file_size: uniqueContent.byteLength,
          media_type: "application/epub+zip",
          deleted_at: null,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const foreignKeyCheck = await env.DATABASE.prepare(
      "PRAGMA foreign_key_check",
    ).all();
    expect(foreignKeyCheck.results).toEqual([]);
  });
});

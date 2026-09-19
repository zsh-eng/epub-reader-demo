/** Independent field-by-field check of a converted local SQLite snapshot. */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { encodeSyncKey } from "@zsh-eng/local-sync";
const [sourcePath, targetPath, aliasesPath] = process.argv.slice(2);
const aliases: Record<string, string> | undefined = aliasesPath
  ? await Bun.file(aliasesPath).json()
  : undefined;
if (!sourcePath || !targetPath)
  throw Error(
    "Usage: bun scripts/sync-migration/verify.ts source.sqlite converted.sqlite",
  );
const source = new Database(sourcePath, { readonly: true }),
  target = new Database(targetPath, { readonly: true });
const mapping: Record<
  string,
  {
    type: string;
    id: string[];
    fields: Record<string, string>;
    dates?: string[];
    flags?: string[];
  }
> = {
  cards: {
    type: "card",
    id: ["id"],
    fields: {
      id: "id",
      due: "due",
      stability: "stability",
      difficulty: "difficulty",
      elapsed_days: "elapsed_days",
      scheduled_days: "scheduled_days",
      reps: "reps",
      lapses: "lapses",
      state: "state",
      last_review: "last_review",
    },
    dates: ["due", "last_review"],
  },
  card_contents: {
    type: "cardContent",
    id: ["card_id"],
    fields: { card_id: "cardId", front: "front", back: "back" },
  },
  card_deleted: {
    type: "cardDeleted",
    id: ["card_id"],
    fields: { card_id: "cardId", deleted: "deleted" },
    flags: ["deleted"],
  },
  card_bookmarked: {
    type: "cardBookmarked",
    id: ["card_id"],
    fields: { card_id: "cardId", bookmarked: "bookmarked" },
    flags: ["bookmarked"],
  },
  card_suspended: {
    type: "cardSuspended",
    id: ["card_id"],
    fields: { card_id: "cardId", suspended: "suspended" },
    dates: ["suspended"],
  },
  card_metadata: {
    type: "cardMetadata",
    id: ["card_id"],
    fields: { card_id: "cardId", note_id: "noteId", sibling_tag: "siblingTag" },
  },
  decks: {
    type: "deck",
    id: ["id"],
    fields: {
      id: "id",
      name: "name",
      description: "description",
      deleted: "deleted",
    },
    flags: ["deleted"],
  },
  card_decks: {
    type: "updateDeckCard",
    id: ["deck_id", "card_id"],
    fields: { deck_id: "deckId", card_id: "cardId" },
  },
  review_logs: {
    type: "reviewLog",
    id: ["id"],
    fields: {
      id: "id",
      card_id: "cardId",
      grade: "grade",
      state: "state",
      due: "due",
      stability: "stability",
      difficulty: "difficulty",
      elapsed_days: "elapsed_days",
      last_elapsed_days: "last_elapsed_days",
      scheduled_days: "scheduled_days",
      review: "review",
      duration: "duration",
      created_at: "createdAt",
    },
    dates: ["due", "review", "created_at"],
  },
  review_log_deleted: {
    type: "reviewLogDeleted",
    id: ["review_log_id"],
    fields: { review_log_id: "reviewLogId", deleted: "deleted" },
    flags: ["deleted"],
  },
};
let records = 0,
  fields = 0;
const lookup = target.query(
  "SELECT * FROM sync_records WHERE user_id=? AND key=?",
);
for (const [table, def] of Object.entries(mapping)) {
  for (const row of source.query(`SELECT * FROM ${table}`).all() as Record<
    string,
    string | number | null
  >[]) {
    const id = JSON.stringify([
      def.type,
      def.id.length === 1
        ? row[def.id[0]]
        : JSON.stringify(def.id.map((k) => row[k])),
    ]);
    const family = def.type.startsWith("reviewLog")
      ? "reviewLogOperations"
      : "operations";
    const stored = lookup.get(row.user_id, encodeSyncKey(family, id)) as {
      value: string;
      device_id: string;
      hlc_wall_time_ms: number;
    };
    assert.ok(stored, `${table}: missing record`);
    const op = JSON.parse(stored.value);
    assert.equal(op.id, id);
    assert.equal(op.type, def.type);
    assert.equal(stored.device_id, row.last_modified_client);
    assert.equal(stored.hlc_wall_time_ms, row.last_modified ?? row.created_at);
    for (const [column, field] of Object.entries(def.fields)) {
      let expected: unknown = row[column];
      if (def.dates?.includes(column) && expected !== null)
        expected = new Date(Number(expected)).toISOString();
      if (def.flags?.includes(column)) expected = !!expected;
      if (
        aliases &&
        table === "card_contents" &&
        (column === "front" || column === "back")
      ) {
        expected = String(expected).replace(
          /https?:\/\/api\.spaced2\.zsheng\.app\/api\/files\/([a-zA-Z0-9-]+\/[a-zA-Z0-9-]+)/g,
          (_, key) => {
            assert.ok(aliases[key], `Missing file alias: ${key}`);
            assert.equal(key.split("/")[0], row.user_id);
            return `/api/files/${aliases[key]}`;
          },
        );
      }
      assert.deepEqual(op.payload[field], expected, `${table}.${column}`);
      fields++;
    }
    if (table === "cards" || table === "review_logs")
      assert.equal(op.payload.learning_steps, 0);
    if (table === "card_decks") {
      const present = Number(row.cl_count) % 2 === 1;
      assert.equal(op.payload.present, present);
      assert.equal(op.isDeleted, !present);
    }
    records++;
  }
}
assert.equal(
  (target.query("SELECT count(*) n FROM sync_records").get() as { n: number })
    .n,
  records,
);
assert.deepEqual(target.query("PRAGMA integrity_check").all(), [
  { integrity_check: "ok" },
]);
assert.deepEqual(target.query("PRAGMA foreign_key_check").all(), []);
console.log(
  JSON.stringify({ records, fields, integrity: "ok", foreignKeys: 0 }, null, 2),
);
source.close();
target.close();

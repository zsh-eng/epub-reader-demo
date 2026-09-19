import { encodeSyncKey, syncRecordSchema } from "@zsh-eng/local-sync";
import { operationSchema } from "../../src/lib/sync/schema";
import { toStoredOperation } from "../../src/lib/sync/records";

type LegacyRow = Record<string, string | number | null>;
export const legacyTables = [
  "cards",
  "card_contents",
  "card_deleted",
  "card_bookmarked",
  "card_suspended",
  "card_metadata",
  "decks",
  "card_decks",
  "review_logs",
  "review_log_deleted",
] as const;
export function convertRow(
  table: (typeof legacyTables)[number],
  row: LegacyRow,
  sequence: number,
) {
  const timestamp = Number(row.last_modified ?? row.created_at);
  const p = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, row[name]]));
  let type: string;
  let payload: Record<string, unknown>;
  switch (table) {
    case "cards":
      type = "card";
      payload = {
        ...p([
          "id",
          "due",
          "stability",
          "difficulty",
          "elapsed_days",
          "scheduled_days",
          "reps",
          "lapses",
          "state",
          "last_review",
        ]),
        learning_steps: 0,
      };
      break;
    case "card_contents":
      type = "cardContent";
      payload = { cardId: row.card_id, ...p(["front", "back"]) };
      break;
    case "card_deleted":
      type = "cardDeleted";
      payload = { cardId: row.card_id, deleted: !!row.deleted };
      break;
    case "card_bookmarked":
      type = "cardBookmarked";
      payload = { cardId: row.card_id, bookmarked: !!row.bookmarked };
      break;
    case "card_suspended":
      type = "cardSuspended";
      payload = { cardId: row.card_id, suspended: row.suspended };
      break;
    case "card_metadata":
      type = "cardMetadata";
      payload = {
        cardId: row.card_id,
        noteId: row.note_id,
        siblingTag: row.sibling_tag,
      };
      break;
    case "decks":
      type = "deck";
      payload = { ...p(["id", "name", "description"]), deleted: !!row.deleted };
      break;
    case "card_decks":
      type = "updateDeckCard";
      payload = {
        deckId: row.deck_id,
        cardId: row.card_id,
        present: Number(row.cl_count) % 2 === 1,
      };
      break;
    case "review_logs":
      type = "reviewLog";
      payload = {
        ...p([
          "id",
          "grade",
          "state",
          "due",
          "stability",
          "difficulty",
          "elapsed_days",
          "last_elapsed_days",
          "scheduled_days",
          "review",
          "duration",
        ]),
        cardId: row.card_id,
        createdAt: row.created_at,
        learning_steps: 0,
      };
      break;
    case "review_log_deleted":
      type = "reviewLogDeleted";
      payload = { reviewLogId: row.review_log_id, deleted: !!row.deleted };
      break;
  }
  const op = operationSchema.parse({ type, payload, timestamp });
  const record = toStoredOperation(op);
  const target =
    type === "reviewLog" || type === "reviewLogDeleted"
      ? "reviewLogOperations"
      : "operations";
  return {
    userId: String(row.user_id),
    record: syncRecordSchema.parse({
      key: encodeSyncKey(target, record.id),
      value: JSON.stringify(record),
      schemaVersion: 1,
      isDeleted: record.isDeleted,
      hlc: { wallTimeMs: timestamp, counter: 0 },
      deviceId: String(row.last_modified_client),
      serverSeq: sequence,
    }),
  };
}

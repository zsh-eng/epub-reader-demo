/** The application connection records local mutations in the sync outbox. */
export { syncV2Db as db } from "@/lib/sync-v2/db";

/** Domain reads exclude tombstones; the raw sync connection can still read them. */

export function isNotDeleted(record: { isDeleted: boolean }): boolean {
  return !record.isDeleted;
}

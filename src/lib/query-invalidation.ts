import { syncV2Db, type SYNC_V2_SYNCED_TABLES } from "@/lib/sync-v2/db";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import Dexie, { type ObservabilitySet } from "dexie";

type SyncedTable = (typeof SYNC_V2_SYNCED_TABLES)[number];

/** Query prefixes that read each domain table, including combined views. */
const TABLE_QUERY_KEYS = {
  books: [["books"], ["highlights", "all"], ["readingSessions"]],
  readingCheckpoints: [
    ["readingCheckpoint"],
    ["readingCheckpoints"],
    ["books", "list"],
  ],
  readingSessions: [["readingSessions"]],
  highlights: [["highlights"]],
  // The current Reader settings use localStorage, not this legacy sync table.
  readingSettings: [],
  readingState: [["readingStatus"], ["books", "list"]],
  notes: [["notes"]],
} satisfies Record<SyncedTable, readonly QueryKey[]>;

/**
 * Refreshes domain queries after committed local or remote writes. Dexie's
 * storage event also covers other connections and tabs. Outbox acknowledgements
 * and derived-cache writes have no dependencies here, so warm Reader data stays
 * intact. Notify once per transaction, after its data is available to readers.
 */
export function subscribeToQueryInvalidation(
  queryClient: QueryClient,
  databaseName = syncV2Db.name,
): () => void {
  const onStorageMutated = (parts: ObservabilitySet) => {
    // Dexie documents each part as idb://database/table/index.
    const changedParts = Object.keys(parts);
    const queryPrefixes = Object.entries(TABLE_QUERY_KEYS).flatMap(
      ([table, keys]) =>
        changedParts.some((part) =>
          part.startsWith(`idb://${databaseName}/${table}/`),
        )
          ? keys
          : [],
    );
    if (queryPrefixes.length === 0) return;

    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryPrefixes.some((prefix) =>
          prefix.every((part, index) => queryKey[index] === part),
        ),
    });
  };

  Dexie.on("storagemutated", onStorageMutated);
  return () => Dexie.on("storagemutated").unsubscribe(onStorageMutated);
}

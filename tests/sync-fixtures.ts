import { encodeSyncKey } from "@zsh-eng/local-sync";
import { toStoredOperation } from "@/lib/sync/records";
export function deckRecord(id: string, name: string, serverSeq = 1) {
  const row = toStoredOperation({
    type: "deck",
    payload: { id, name, description: "", deleted: false },
    timestamp: 1000,
  });
  return {
    key: encodeSyncKey("operations", row.id),
    value: JSON.stringify(row),
    schemaVersion: 1,
    hlc: { wallTimeMs: 1000, counter: 0 },
    deviceId: "server-seed",
    isDeleted: false,
    serverSeq,
  };
}

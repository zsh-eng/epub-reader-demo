import { useClock } from "./use-clock";
import { getSessionExpiry } from "@/lib/sync/meta";
import { useLiveQuery } from "dexie-react-hooks";

export function useSessionExpired() {
  const sessionExpiry = useLiveQuery(getSessionExpiry);
  const now = useClock(sessionExpiry ? [sessionExpiry.getTime()] : []);
  if (!sessionExpiry) {
    return false;
  }

  return now >= sessionExpiry.getTime();
}

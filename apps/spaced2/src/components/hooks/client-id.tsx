import { db } from "@/lib/db/persistence";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

export function useClientId() {
  const clientId = useLiveQuery(() => db.metadataKv.get("clientId"));
  const [clientIdState, setClientIdState] = useState<string | null>(null);

  useEffect(() => {
    setClientIdState(clientId?.value as string);
  }, [clientId]);

  return clientIdState;
}

import {
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncRemote,
} from "@zsh-eng/local-sync";

export function createRemote(signal: AbortSignal): SyncRemote {
  const request = async (path: string, deviceId: string, body?: unknown) => {
    const response = await fetch(
      `${import.meta.env.VITE_BACKEND_URL}/sync/v2/${path}`,
      {
        credentials: "include",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-ID": deviceId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    signal.throwIfAborted();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Sign in to sync"
          : `Sync failed (${response.status}). The server must be migrated first.`,
      );
    return response.json();
  };
  return {
    async pull(deviceId, query) {
      const params = new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      );
      return syncPullResponseSchema.parse(
        await request(`pull?${params}`, deviceId),
      );
    },
    async push(deviceId, changes) {
      return syncPushResponseSchema.parse(
        await request("push", deviceId, { changes }),
      );
    },
  };
}

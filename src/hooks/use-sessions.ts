import { honoClient } from "@/lib/api";
import type { SessionInfo } from "@/types/session";
import { useQuery } from "@tanstack/react-query";

/**
 * Query keys for sessions
 */
export const sessionKeys = {
  all: ["sessions"] as const,
};

/**
 * Hook for fetching the current user's active sessions
 */
export function useSessions() {
  return useQuery({
    queryKey: sessionKeys.all,
    queryFn: async (): Promise<SessionInfo[]> => {
      const res = await honoClient.api.sessions.$get();

      if (!res.ok) {
        throw new Error("Failed to fetch sessions");
      }

      const data = await res.json();
      return data.sessions;
    },
  });
}

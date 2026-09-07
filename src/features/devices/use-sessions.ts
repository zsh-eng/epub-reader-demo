import { getLabRuntime } from "@/features/sync-lab/runtime";
import { useAuth } from "@/hooks/use-auth";
import { honoClient } from "@/lib/api";
import type { SessionInfo } from "@/types/session";
import { useQuery } from "@tanstack/react-query";

/**
 * Query keys for sessions
 */
export const sessionKeys = {
  all: ["sessions"] as const,
  forUser: (userId: string | undefined) => ["sessions", userId] as const,
};

/**
 * Hook for fetching the current user's active sessions
 */
export function useSessions() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const userId = !isLoading && isAuthenticated ? user?.id : undefined;
  return useQuery({
    networkMode: "online", // Account sessions must be fetched from the server.
    queryKey: sessionKeys.forUser(userId),
    enabled: !!userId,
    queryFn: async (): Promise<SessionInfo[]> => {
      const lab = getLabRuntime();
      if (lab)
        return [
          {
            id: lab.deviceId,
            browser: { name: "Sync Lab", version: "" },
            os: { name: "Simulated client", version: "" },
            deviceType: "mobile",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(lab.now()).toISOString(),
            isCurrent: true,
          },
        ];
      const res = await honoClient.api.sessions.$get();

      if (!res.ok) {
        throw new Error("Failed to fetch sessions");
      }

      const data = await res.json();
      return data.sessions;
    },
  });
}

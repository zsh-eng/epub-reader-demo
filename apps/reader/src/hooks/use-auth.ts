import { getLabRuntime } from "@/features/sync-lab/runtime";
import { useSession } from "@/lib/auth-client";

function useRealAuth() {
  const { data: session, isPending, error } = useSession();

  return {
    user: session?.user,
    session: session?.session,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    error,
  };
}

/** Lab sessions are synthetic. Do not subscribe to the real auth client. */
function useLabAuth(): ReturnType<typeof useRealAuth> {
  return {
    user: {
      id: "sync-lab-user",
      name: "Sync Lab",
      email: "lab@example.invalid",
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      image: null,
    },
    session: undefined,
    isLoading: false,
    isAuthenticated: true,
    error: null,
  };
}

// Runtime selection is fixed before React mounts this application.
export const useAuth = getLabRuntime() ? useLabAuth : useRealAuth;

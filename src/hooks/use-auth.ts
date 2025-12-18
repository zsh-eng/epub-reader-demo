import { useSession } from "@/lib/auth-client";

export function useAuth() {
  const { data: session, isPending, error } = useSession();

  return {
    user: session?.user,
    session: session?.session,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    error,
  };
}

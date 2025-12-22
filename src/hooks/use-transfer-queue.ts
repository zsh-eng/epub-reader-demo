import { useAuth } from "@/hooks/use-auth";
import { transferQueue } from "@/lib/files/transfer-queue";
import { useEffect, useRef } from "react";

/**
 * Hook for managing the transfer queue lifecycle based on authentication state.
 *
 * This hook:
 * - Pauses the transfer queue when the user is not authenticated
 * - Resumes the transfer queue when the user is authenticated
 * - Ensures the queue doesn't attempt network operations while logged out
 *
 * Usage: Call this hook once in your root component (e.g., App.tsx)
 * alongside useSync().
 */
export function useTransferQueue(): void {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    // Initialize on first run
    if (!initialized.current) {
      initialized.current = true;

      // Set initial state based on auth
      if (isAuthenticated) {
        transferQueue.resume();
      } else {
        transferQueue.pause();
      }
      return;
    }

    // Handle auth state changes
    if (isAuthenticated) {
      transferQueue.resume();
    } else {
      transferQueue.pause();
    }
  }, [isAuthenticated, isAuthLoading]);

  // Cleanup: pause on unmount (though this should rarely happen)
  useEffect(() => {
    return () => {
      transferQueue.pause();
    };
  }, []);
}

import {
  getRuntimeOnline,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { useAuth } from "@/hooks/use-auth";
import { files } from "@/lib/files";
import { useEffect } from "react";

/** Run durable file uploads only for an authenticated, online application. */
export function useFileUploads(): void {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    if (isAuthLoading) {
      files.pauseUploads();
      return;
    }

    const updateUploadState = () => {
      if (isAuthenticated && getRuntimeOnline()) {
        files.resumeUploads();
      } else {
        files.pauseUploads();
      }
    };

    updateUploadState();
    const unsubscribe = subscribeRuntimeOnline(updateUploadState);

    return () => {
      unsubscribe();
      files.pauseUploads();
    };
  }, [isAuthenticated, isAuthLoading]);
}

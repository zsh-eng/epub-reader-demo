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
      if (isAuthenticated && navigator.onLine) {
        files.resumeUploads();
      } else {
        files.pauseUploads();
      }
    };

    updateUploadState();
    window.addEventListener("online", updateUploadState);
    window.addEventListener("offline", updateUploadState);

    return () => {
      window.removeEventListener("online", updateUploadState);
      window.removeEventListener("offline", updateUploadState);
      files.pauseUploads();
    };
  }, [isAuthenticated, isAuthLoading]);
}

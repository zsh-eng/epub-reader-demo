import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function ReloadPrompt() {
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      console.log("SW Registered:", registration);
      setRegistration(registration ?? null);
    },
    onRegisterError(error) {
      console.error("SW registration error:", error);
    },
  });

  // Registration can complete asynchronously; the mounted component owns polling.
  useEffect(() => {
    if (!registration) return;
    const timer = window.setInterval(() => {
      void registration.update().catch((error) => {
        console.error("SW update check failed:", error);
      });
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [registration]);

  useEffect(() => {
    if (offlineReady) {
      toast.success("App ready to work offline", {
        id: "pwa-offline-ready",
        duration: 3000,
        onDismiss: () => setOfflineReady(false),
        onAutoClose: () => setOfflineReady(false),
      });
    }
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (needRefresh) {
      toast.info("New version available", {
        id: "pwa-update-available",
        description: "Click reload to update the app",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => updateServiceWorker(true),
        },
        onDismiss: () => setNeedRefresh(false),
      });
    }
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}

import { useSyncExternalStore } from "react";

export const useOnlineStatus = () => {
  const subscribe = (callback: () => void) => {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
      window.removeEventListener("online", callback);
      window.removeEventListener("offline", callback);
    };
  };

  const getSnapshot = () => navigator.onLine;
  return useSyncExternalStore(subscribe, getSnapshot);
};

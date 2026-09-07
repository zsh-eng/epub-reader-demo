import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";

export const DEBUG_ENABLED_STORAGE_KEY = "reader-debug-enabled-v1";

/** Only an explicit choice overrides the build default. This preference is local to this site. */
function readDebugEnabled(): boolean {
  try {
    const saved = getRuntimeStorage().getItem(DEBUG_ENABLED_STORAGE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    // Storage can be unavailable; the session still supports the switch.
  }
  return import.meta.env.DEV;
}

let debugEnabled = readDebugEnabled();
const listeners = new Set<() => void>();

export function getDebugEnabled(): boolean {
  return debugEnabled;
}

function publish(enabled: boolean): void {
  if (enabled === debugEnabled) return;
  debugEnabled = enabled;
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent): void {
  if (event.key === DEBUG_ENABLED_STORAGE_KEY || event.key === null) {
    publish(readDebugEnabled());
  }
}

export function subscribeDebugPreference(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0)
      window.removeEventListener("storage", handleStorage);
  };
}

export function setDebugEnabled(enabled: boolean): void {
  try {
    getRuntimeStorage().setItem(DEBUG_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Keep the in-memory preference usable when storage is unavailable.
  }
  publish(enabled);
}

export function useDebugEnabled(): boolean {
  return useSyncExternalStore(
    subscribeDebugPreference,
    getDebugEnabled,
    getDebugEnabled,
  );
}

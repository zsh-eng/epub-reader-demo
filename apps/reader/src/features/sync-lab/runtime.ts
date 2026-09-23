import type { FileRemoteApi } from "@/lib/files/file-remote-api";
import type { SyncV2Remote, SyncV2Event } from "@/lib/sync-v2/sync";

/** Installed by the frame bootstrap before any application singleton is loaded. */
export interface LabRuntimeConfig {
  databaseName: string;
  deviceId: string;
  storage: Storage;
  syncRemote: SyncV2Remote;
  fileRemote: FileRemoteApi;
  isOnline(): boolean;
  subscribeOnline(listener: () => void): () => void;
  autoSync(): boolean;
  subscribeAutoSync(listener: () => void): () => void;
  now(): number;
  onSyncEvent?: (event: SyncV2Event) => void;
}

declare global {
  interface Window {
    __SYNC_LAB_RUNTIME__?: LabRuntimeConfig;
  }
}

export function configureLabRuntime(config: LabRuntimeConfig): void {
  if (!config.databaseName.startsWith("sync-lab-")) {
    throw new Error("Lab databases must use the sync-lab- prefix");
  }
  if (window.__SYNC_LAB_RUNTIME__) {
    throw new Error("A lab frame runtime cannot be replaced");
  }
  window.__SYNC_LAB_RUNTIME__ = config;
}

export function getLabRuntime(): LabRuntimeConfig | undefined {
  return typeof window === "undefined"
    ? undefined
    : window.__SYNC_LAB_RUNTIME__;
}

export function getRuntimeStorage(): Storage {
  return getLabRuntime()?.storage ?? localStorage;
}

export function getRuntimeOnline(): boolean {
  return (
    getLabRuntime()?.isOnline() ??
    (typeof navigator === "undefined" || navigator.onLine)
  );
}

export function subscribeRuntimeOnline(
  listener: (online: boolean) => void,
): () => void {
  const lab = getLabRuntime();
  if (lab) return lab.subscribeOnline(() => listener(lab.isOnline()));
  const online = () => listener(true);
  const offline = () => listener(false);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}

const pendingDrains = new Set<() => Promise<void>>();

/** Keep cleanup writes reachable until their owner has finished persisting. */
export function registerLabDrain(drain: () => Promise<void>): () => void {
  if (!getLabRuntime()) return () => {};
  pendingDrains.add(drain);
  return () => {
    void drain().then(
      () => pendingDrains.delete(drain),
      () => pendingDrains.delete(drain),
    );
  };
}

/** Called after React unmount has queued final checkpoint and session writes. */
export async function drainLabWork(): Promise<void> {
  await Promise.all([...pendingDrains].map((drain) => drain()));
}

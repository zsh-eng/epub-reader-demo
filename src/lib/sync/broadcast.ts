// Same-origin tabs share IndexedDB and its device identity. Refresh their UI after writes.
const channel =
  typeof window !== "undefined" && typeof window.BroadcastChannel === "function"
    ? new window.BroadcastChannel("spaced-records-v2")
    : undefined;
export function broadcastRecordsChanged() {
  channel?.postMessage("changed");
}
export function broadcastRecordsCleared() {
  channel?.postMessage("cleared");
}
export function listenForRecordChanges(listener: (cleared: boolean) => void) {
  if (channel)
    channel.onmessage = (event) => listener(event.data === "cleared");
}

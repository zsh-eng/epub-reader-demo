let nativeActive = true;
const NATIVE_VISIBILITY_EVENT = "reader-native-visibility";

/** Native AppState and screen focus supplement WebKit visibility events. */
export function setNativeActive(active: boolean): void {
  nativeActive = active;
  window.dispatchEvent(new Event(NATIVE_VISIBILITY_EVENT));
}

export function isReaderVisible(): boolean {
  return nativeActive && document.visibilityState === "visible";
}

export function subscribeReaderVisibility(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  window.addEventListener(NATIVE_VISIBILITY_EVENT, callback);
  return () => {
    document.removeEventListener("visibilitychange", callback);
    window.removeEventListener(NATIVE_VISIBILITY_EVENT, callback);
  };
}

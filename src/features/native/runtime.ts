/** Fixed at build time. The website never enables the native bridge. */
export const isNativeApp = import.meta.env.VITE_NATIVE_APP === "true";

export function postNative(message: Record<string, unknown>): void {
  if (!isNativeApp) return;
  window.ReactNativeWebView?.postMessage(
    JSON.stringify({ version: 1, ...message }),
  );
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __readerInitialState?: unknown;
  }
}

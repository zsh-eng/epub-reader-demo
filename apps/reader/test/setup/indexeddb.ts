import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Reset IndexedDB between tests to ensure isolation
export function resetIndexedDB() {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: new IDBFactory(),
  });
}

// happy-dom returns null for canvas.getContext('2d'), which breaks @chenglou/pretext's
// font measurement. Provide a minimal mock so text layout tests can run.
const mockCtx = {
  font: "",
  measureText(text: string) {
    return { width: text.length * 8 };
  },
};

// biome-ignore lint/suspicious/noExplicitAny: patching canvas prototype for test environment
(HTMLCanvasElement.prototype as any).getContext = function (contextId: string) {
  if (contextId === "2d") return mockCtx;
  return null;
};

import { Window } from "happy-dom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const testWindow = new Window({ url: "http://localhost:5178" });
const browserGlobals = [
  "window", "document", "navigator", "location", "localStorage", "sessionStorage",
  "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement",
  "Element", "Node", "Text", "Document", "DocumentFragment", "SVGElement",
  "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent",
  "MutationObserver", "ResizeObserver", "DOMParser", "getComputedStyle",
] as const;
for (const key of browserGlobals) {
  const value = key === "window" ? testWindow : testWindow[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.assign(globalThis, {
  indexedDB, IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
});
Object.assign(testWindow, { indexedDB, IDBKeyRange });

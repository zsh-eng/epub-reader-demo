import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Reset IndexedDB between tests to ensure isolation
export function resetIndexedDB() {
  indexedDB = new IDBFactory();
}

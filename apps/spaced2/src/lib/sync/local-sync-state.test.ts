import { expect, test } from "bun:test";
import { createLocalSyncState } from "./local-sync-state";
import { createSyncClientState } from "@zsh-eng/local-sync";
test("publishing a sync cursor preserves clocks reserved by concurrent local reviews", () => {
  let state = createSyncClientState("device");
  const persisted = {
    read: () => state,
    write: (next: typeof state) => {
      state = next;
    },
  };
  const sync = createLocalSyncState(persisted);
  sync.store.write({
    ...sync.store.read()!,
    pullCursor: 42,
    hlc: { wallTimeMs: 10, counter: 2 },
  });
  state = { ...state, hlc: { wallTimeMs: 10, counter: 9 } };
  sync.checkpoint();
  expect(state.pullCursor).toBe(42);
  expect(state.hlc.counter).toBe(9);
  state = createSyncClientState("other-device");
  expect(() => sync.checkpoint()).toThrow("account/device changed");
});

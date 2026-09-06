import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createSyncV2ApplicationDb,
  type EPUBReaderSyncV2DB,
} from "@/lib/sync-v2/db";
import { resetIndexedDB } from "../setup/indexeddb";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import type { Note, NoteTarget } from "@/types/note";

let db: EPUBReaderSyncV2DB;
let notes: Note[];
vi.mock("@/data/database", () => ({
  get db() {
    return db;
  },
  isNotDeleted: (row: { isDeleted: boolean }) => !row.isDeleted,
}));
vi.mock("@/hooks/use-notes-query", () => ({
  useBookNotesQuery: () => ({ data: notes }),
  noteKeys: { book: (id: string) => ["notes", id] },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock("@/data/note-drafts", async (original) => {
  const actual = await original<typeof import("@/data/note-drafts")>();
  return { ...actual, submitNoteDraft: vi.fn(actual.submitNoteDraft) };
});
import { submitNoteDraft } from "@/data/note-drafts";
import { createNote, getBookNotes } from "@/data/notes";
import { useReaderNotes } from "@/features/reader/hooks/use-reader-notes";

const target: NoteTarget = {
  kind: "page",
  anchor: {
    spineItemId: "chapter",
    startOffset: 10,
    endOffset: 10,
    textBefore: "before",
    textAfter: "after",
  },
};

beforeEach(async () => {
  resetIndexedDB();
  localStorage.clear();
  getOrCreateSyncClientState("note-edit-test");
  db = createSyncV2ApplicationDb("reader-note-edit-test");
  await db.open();
  await createNote("book", "Original", target);
  notes = await getBookNotes("book");
});
afterEach(async () => {
  cleanup();
  await db.delete();
  vi.clearAllMocks();
});

it("does not rewrite a deleted edit draft when the UI closes during submission", async () => {
  const actual =
    await vi.importActual<typeof import("@/data/note-drafts")>(
      "@/data/note-drafts",
    );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(submitNoteDraft).mockImplementationOnce(async (id) => {
    const committed = await actual.submitNoteDraft(id);
    await gate;
    return committed;
  });
  const { result } = renderHook(() => useReaderNotes("book"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.change("Unsent thought", target));
  await act(async () => {
    await result.current.edit(notes[0].id);
  });
  act(() => result.current.change("Revised", target));
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.send();
  });
  await waitFor(async () =>
    expect((await getBookNotes("book"))[0].content).toBe("Revised"),
  );
  await act(async () => {
    await result.current.flush(); // The same call made when closing the composer.
    release();
    expect(await saving).toBe(true);
  });
  expect(result.current.draft?.content).toBe("Unsent thought");
  expect(result.current.error).toBe("");
  expect((await getBookNotes("book"))[0].content).toBe("Revised");
  expect(
    (await db.noteDrafts.toArray()).map(({ purpose, content }) => ({
      purpose,
      content,
    })),
  ).toEqual([{ purpose: "create", content: "Unsent thought" }]);
});

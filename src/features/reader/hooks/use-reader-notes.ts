import { useBookNotesQuery, noteKeys } from "@/hooks/use-notes-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  beginNoteDraft,
  createNoteDraftId,
  getNoteDraft,
  saveNoteDraft,
  submitNoteDraft,
} from "@/data/note-drafts";
import type { Note, NoteTarget } from "@/types/note";
import { useCallback, useEffect, useRef, useState } from "react";

/** Book-scoped draft writer. Calls are serialized; typing never updates the book query.
 * The Reader mounts this below its pagination owner, so keystrokes do not render Reader.
 */
export function useReaderNotes(bookId: string) {
  const query = useBookNotesQuery(bookId);
  const client = useQueryClient();
  const [draft, setDraft] = useState<{
    content: string;
    target: NoteTarget;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(draft);
  const writing = useRef(Promise.resolve());
  const submitting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const id = createNoteDraftId(bookId);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = current.current;
    if (!snapshot) return writing.current;
    const work = writing.current
      .catch(() => {})
      .then(async () => {
        await beginNoteDraft(bookId, snapshot.target);
        await saveNoteDraft(id, snapshot.content, snapshot.target);
      });
    writing.current = work;
    void work.catch(() => {
      if (mounted.current)
        setError(
          "Could not save the draft. Try again before leaving this book.",
        );
    });
    return work;
  }, [bookId, id]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void getNoteDraft(id)
      .then((saved) => {
        if (!active) return;
        if (saved?.purpose === "create") {
          const value = { content: saved.content, target: saved.target };
          current.current = value;
          setDraft(value);
        }
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not restore the draft. Reopen this book to try again.",
          );
      });
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && !submitting.current)
        void flushRef.current().catch(() => {});
    };
    document.addEventListener("visibilitychange", flushOnHide);
    return () => {
      active = false;
      mounted.current = false;
      document.removeEventListener("visibilitychange", flushOnHide);
      if (!submitting.current) void flushRef.current().catch(() => {});
    };
  }, [id]);

  function change(content: string, target: NoteTarget) {
    if (!ready || submitting.current) return;
    const value = { content, target };
    current.current = value;
    setDraft(value);
    setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushRef.current().catch(() => {});
    }, 150);
  }

  async function send() {
    if (!ready || submitting.current || !current.current?.content.trim())
      return false;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await flush();
      const result = await submitNoteDraft(id);
      if (result.status !== "saved") throw new Error(result.status);
      current.current = null;
      setDraft(null);
      await client.invalidateQueries({ queryKey: noteKeys.book(bookId) });
      return true;
    } catch {
      if (mounted.current)
        setError(
          "Could not save the note. Your draft is still here; try sending again.",
        );
      return false;
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return {
    notes: query.data ?? EMPTY_NOTES,
    draft,
    ready,
    saving,
    error: error || (query.isError ? "Could not load notes." : ""),
    change,
    send,
    flush,
  };
}
const EMPTY_NOTES: Note[] = [];

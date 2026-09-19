import { sameNotePassage } from "./note-target";
import { useToast } from "@/hooks/use-toast";
import { NotebookCountIcon } from "./shared/NotebookCountIcon";
import { NotebookNote } from "./NotebookNote";
import { DesktopNotebookNote, NotebookNoteBody } from "./DesktopNotebookNote";
import { ReaderSheet } from "./shared/ReaderSheet";
import type { NoteTarget } from "@/types/note";
import { useReaderNotes } from "./hooks/use-reader-notes";
import { useNotebookDeletion } from "./hooks/use-notebook-deletion";
import { createNoteLocationResolver, noteMarginTop } from "./note-locations";
import type {
  ReaderSessionState,
  ReaderSessionResources,
} from "./hooks/use-reader-session";
import type { ChapterEntry } from "./types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUp,
  Check,
  SlidersHorizontal,
  X,
  MoreHorizontal,
  Palette,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type RefObject,
} from "react";

const transition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const };

interface Location {
  page: number;
  chapter: string;
}
/** Book-scoped notebook UI; durable capture is owned by useReaderNotes. */
export function ReaderNotesPrototype({
  bookId,
  chapters,
  chapterAccess,
  pagination,
  locateAnchors,
  location,
  children,
  notebook,
  setNotebook,
  open,
  onActiveChange,
  onMobileComposerPresenceChange,
  onVisit,
  margin,
  desktop,
  embeddedNotebook = false,
  commentPosition,
  quote: incomingTarget,
  onClearQuote,
  mobileAnnotation,
}: {
  mobileAnnotation?: {
    identity: object;
    tools: ReactNode;
    captureTarget: () => NoteTarget | null;
    close: () => void;
  };
  bookId: string;
  chapters: ChapterEntry[];
  chapterAccess: ReaderSessionResources["chapterAccess"];
  pagination: ReaderSessionState["pagination"];
  locateAnchors: ReaderSessionResources["locateAnchors"];
  children: (panel: ReactNode) => ReactNode;
  notebook: boolean;
  setNotebook: (open: boolean) => void;
  commentPosition: { top: number; page: number };
  desktop: boolean;
  embeddedNotebook?: boolean;
  quote: NoteTarget | null;
  onClearQuote: () => void;
  margin: { width: number; location: Location; enabled: boolean };
  location: Location;
  open: boolean;
  onActiveChange: (active: boolean) => void;
  onMobileComposerPresenceChange: (present: boolean) => void;
  onVisit: (page: number) => void;
}) {
  // Capture each selection once. Refocusing after Remove quote must not attach it again.
  const capturedAnnotation = useRef<object | null>(null);
  const composerOpen = open || Boolean(mobileAnnotation);
  // Keep reading chrome suppressed through exit, including quick dismiss/reopen.
  useLayoutEffect(() => {
    if (desktop) onMobileComposerPresenceChange(false);
    else if (composerOpen && !notebook) onMobileComposerPresenceChange(true);
  }, [desktop, composerOpen, notebook, onMobileComposerPresenceChange]);
  useLayoutEffect(
    () => () => onMobileComposerPresenceChange(false),
    [onMobileComposerPresenceChange],
  );
  const reduceMotion = useReducedMotion();
  const { toast } = useToast();
  const [writing, setWriting] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<NoteTarget | null>(null);
  const [order, setOrder] = useState<"time" | "chapter">("time");
  const notes = useReaderNotes(bookId);
  const { deleteNote, restoredEntries } = useNotebookDeletion({
    remove: notes.remove,
    restore: notes.restore,
    shortcutEnabled: desktop && open && notebook && !notes.editingId,
  });
  const noteCount = notes.notes.filter((note) => note.kind === "note").length;
  const composerDraft = desktop ? notes.composeDraft : notes.draft;
  const inlineEditing = desktop && Boolean(notes.editingId);
  const draft = composerDraft?.content ?? "";
  const hasDraftText = draft.trim().length > 0;
  const target = composerDraft?.target;
  const editedNote = useMemo(
    () =>
      notes.editingId
        ? notes.notes.find((note) => note.id === notes.editingId)
        : undefined,
    [notes.notes, notes.editingId],
  );
  const editQuote =
    !desktop && editedNote?.kind === "note" ? editedNote.quote : undefined;
  const quote = editQuote
    ? { selectedText: editQuote.text, color: editQuote.color }
    : target?.kind === "highlight"
      ? { selectedText: target.quote.text, color: target.quote.color }
      : target?.kind === "selection"
        ? { selectedText: target.text, color: "invisible" }
        : null;
  // The top row has one purpose at a time. Restored text shows its attachment
  // before focus, so a new selection cannot appear to own an older draft.
  const mobileContextVisible = Boolean(
    (quote || pendingTarget) &&
    !showTools &&
    (writing || hasDraftText || !mobileAnnotation),
  );
  const resolver = useMemo(
    () =>
      createNoteLocationResolver(
        chapters,
        chapterAccess,
        pagination.paginationConfig,
      ),
    [chapters, chapterAccess, pagination.paginationConfig],
  );
  const resolved = useMemo(
    () =>
      (!pagination.spread || pagination.status === "idle"
        ? []
        : notes.notes
      ).map((note) => ({
        note,
        anchor: resolver.resolve(note.anchor),
      })),
    [notes.notes, resolver, pagination.status, pagination.spread],
  );
  useEffect(() => {
    if (!resolved.length) return;
    locateAnchors(
      resolved.flatMap(({ note, anchor }) =>
        anchor ? [{ id: note.id, anchor }] : [],
      ),
    );
  }, [resolved, locateAnchors]);
  const handledTarget = useRef<NoteTarget | null>(null);
  useEffect(() => {
    if (
      !notes.ready ||
      notes.saving ||
      notes.editingId ||
      !incomingTarget ||
      handledTarget.current === incomingTarget
    )
      return;
    handledTarget.current = incomingTarget;
    if (
      !desktop &&
      hasDraftText &&
      target &&
      !sameNotePassage(target, incomingTarget)
    ) {
      setPendingTarget(incomingTarget);
    } else {
      setPendingTarget(null);
      notes.change(draft, incomingTarget);
    }
    onClearQuote();
  }, [
    incomingTarget,
    notes.ready,
    draft,
    notes,
    onClearQuote,
    desktop,
    hasDraftText,
    target,
  ]);
  const entries = useMemo(
    () =>
      resolved.map(({ note, anchor }) => ({
        id: note.id,
        kind: note.kind,
        text: note.kind === "note" ? note.content : "Bookmark",
        location: {
          page:
            anchor && pagination.status !== "recalculating"
              ? (pagination.anchorPages[note.id] ?? 0)
              : 0,
          chapter:
            chapters.find(
              (chapter) => chapter.spineItemId === note.anchor.spineItemId,
            )?.title ?? "Unknown chapter",
        },
        chapterIndex: chapters.findIndex(
          (chapter) => chapter.spineItemId === note.anchor.spineItemId,
        ),
        offset: note.anchor.startOffset,
        createdAt: note.createdAt,
        quote:
          note.kind === "note" && note.quote
            ? { selectedText: note.quote.text, color: note.quote.color }
            : undefined,
        top: noteMarginTop(anchor),
      })),
    [resolved, pagination.anchorPages, pagination.status, chapters],
  );

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const previousKeyboardOpen = useRef(false);
  useEffect(() => {
    if (previousKeyboardOpen.current && !keyboardOpen) {
      setWriting(false);
      if (!pendingTarget) setShowTools(true);
    }
    previousKeyboardOpen.current = keyboardOpen;
  }, [keyboardOpen, pendingTarget]);
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sidebarInput = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const retainedEntry = useRef<{ id: string; offset: number } | null>(null);

  function changeOrder(value: string) {
    const container = list.current;
    const row =
      container &&
      [...container.querySelectorAll<HTMLElement>("[data-note-id]")].find(
        (node) =>
          node.getBoundingClientRect().bottom >
          container.getBoundingClientRect().top,
      );
    retainedEntry.current =
      row && container
        ? {
            id: row.dataset.noteId!,
            offset:
              row.getBoundingClientRect().top -
              container.getBoundingClientRect().top,
          }
        : null;
    setOrder(value === "chapter" ? "chapter" : "time");
  }
  useLayoutEffect(() => {
    const retained = retainedEntry.current;
    const container = list.current;
    if (!retained || !container) return;
    const row = container.querySelector<HTMLElement>(
      `[data-note-id="${retained.id}"]`,
    );
    if (row)
      container.scrollTop +=
        row.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        retained.offset;
    retainedEntry.current = null;
  }, [order]);

  // Position updates bypass React and Motion: scrolling must not wait for a
  // render or an animation. React only owns the keyboard-open layout variant.
  useLayoutEffect(() => {
    const element = composer.current;
    const viewport = window.visualViewport;
    if (!composerOpen || desktop || notebook || !element || !viewport) return;
    const update = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      element.style.bottom = `${inset}px`;
      setKeyboardOpen(
        viewport.scale === 1 && window.innerHeight - viewport.height > 100,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("touchmove", update, { passive: true });
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("touchmove", update);
    };
  }, [composerOpen, desktop, notebook]);

  // Desktop keeps its panel mounted for the sidebar exit. Focus only when
  // the notebook opens; ordinary edits and the exit must not move focus.
  useLayoutEffect(() => {
    if (desktop && open && notebook)
      sidebarInput.current?.focus({ preventScroll: true });
  }, [desktop, open, notebook]);

  const pauseEdit = notes.pauseEdit;
  useEffect(() => {
    if (
      !desktop ||
      (open && notebook) ||
      !notes.editingId ||
      notes.saving ||
      notes.error
    )
      return;
    void pauseEdit().catch(() => {});
  }, [
    desktop,
    open,
    notebook,
    notes.editingId,
    notes.saving,
    notes.error,
    pauseEdit,
  ]);

  const previousList = useRef({ notebook: false, ids: new Set<string>() });
  useLayoutEffect(() => {
    const previous = previousList.current;
    const newNote = entries.some(
      (entry) =>
        !previous.ids.has(entry.id) && !restoredEntries.current.has(entry.id),
    );
    if (notebook && (!previous.notebook || newNote))
      list.current?.scrollTo({ top: list.current.scrollHeight });
    previousList.current = {
      notebook,
      ids: new Set(entries.map((entry) => entry.id)),
    };
  }, [entries, notebook, restoredEntries]);

  const flush = notes.flush;
  const close = useCallback(() => {
    void flush().catch(() => {});
    sidebarInput.current?.blur();
    input.current?.blur();
    setNotebook(false);
    onActiveChange(false);
    mobileAnnotation?.close();
    setKeyboardOpen(false);
    setWriting(false);
    setShowTools(false);
    setPendingTarget(null);
  }, [flush, setNotebook, onActiveChange, mobileAnnotation]);
  async function send() {
    if (!(await notes.send())) return;
    onClearQuote();
    mobileAnnotation?.close();
    if (!notebook) {
      close();
      if (!desktop) toast({ message: "Note saved", duration: 1800 });
    } else sidebarInput.current?.focus();
  }

  const editNote = notes.edit;
  const startEdit = useCallback(
    async (id: string) => {
      // Mobile must focus within the user event to open its keyboard.
      if (!desktop) (notebook ? sidebarInput : input).current?.focus();
      if (!(await editNote(id)) || desktop) return;
      if (!embeddedNotebook) onActiveChange(true);
      (notebook ? sidebarInput : input).current?.focus();
    },
    [editNote, notebook, onActiveChange, desktop, embeddedNotebook],
  );

  const iconButton =
    "flex h-8 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const orderedEntries = useMemo(
    () =>
      order === "time"
        ? entries
        : [...entries].sort(
            (a, b) =>
              a.chapterIndex - b.chapterIndex ||
              a.offset - b.offset ||
              a.createdAt - b.createdAt ||
              a.id.localeCompare(b.id),
          ),
    [order, entries],
  );
  const groupLabel = useCallback(
    (entry: (typeof entries)[number]) => {
      if (order === "chapter") return entry.location.chapter;
      const date = new Date(entry.createdAt);
      if (date.toDateString() === new Date().toDateString()) return "Today";
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [order],
  );
  const marginEntries = entries.filter(
    (entry) =>
      entry.location.page >= location.page &&
      entry.location.page <= margin.location.page,
  );
  // Use one rail geometry for the editor and saved comments. Keep the rail
  // beside the book text instead of attaching it to the window edge.
  const commentWidth = Math.min(360, Math.max(320, margin.width - 32));
  const commentLeft = `calc(100% - ${Math.max(commentWidth + 16, margin.width - 16)}px)`;
  const commentSurface =
    "rounded-xl border border-border/80 bg-background/95 p-3 text-sm shadow-sm";
  function renderNoteInput(inNotebook = false) {
    const footerInput = !desktop && !inNotebook;
    const editingInComposer = !desktop && Boolean(notes.editingId);
    const showQuote = footerInput ? mobileContextVisible : Boolean(quote);
    const sendButton = (
      <button
        aria-label={editingInComposer ? "Save changes" : "Save note"}
        aria-hidden={!hasDraftText}
        tabIndex={hasDraftText ? 0 : -1}
        disabled={
          !notes.ready || notes.saving || !hasDraftText || inlineEditing
        }
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => send()}
        className={`${desktop ? "relative" : "absolute right-0 bottom-0"} flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none ${hasDraftText ? "[transform:scale(1)] opacity-100 disabled:opacity-30" : "pointer-events-none [transform:scale(0.9)] opacity-0"}`}
      >
        {editingInComposer ? <Check size={20} /> : <ArrowUp size={20} />}
      </button>
    );
    return (
      <div>
        {notes.error && inNotebook === notebook && (
          <p role="alert" className="mx-3 mb-2 text-sm text-destructive">
            {notes.error}
          </p>
        )}
        {editingInComposer && (
          <div
            data-note-edit-strip
            className="relative z-0 mx-4 -mb-3 flex h-10 items-center justify-between gap-2 rounded-[2rem] border border-border/50 bg-background/90 px-3 pb-2 text-xs text-muted-foreground backdrop-blur-xl"
          >
            <span>Editing note</span>
            <button
              aria-label="Cancel editing"
              disabled={notes.saving}
              className="self-stretch px-1 hover:text-foreground"
              onClick={() => notes.cancelEdit()}
            >
              Cancel
            </button>
          </div>
        )}
        <div
          data-note-compose-row
          inert={inlineEditing}
          className={
            desktop
              ? `flex items-end ${inlineEditing ? "opacity-45" : ""}`
              : undefined
          }
        >
          <div
            data-note-input-surface
            className={
              footerInput
                ? "relative z-10 min-w-0 border-t border-border/50 px-4 py-2 focus-within:border-ring"
                : `relative z-10 min-w-0 flex-1 border p-1 focus-within:ring-2 focus-within:ring-ring/60 ${
                    desktop && inNotebook
                      ? "rounded-(--sidebar-panel-field-radius) border-border/50 bg-secondary/35 focus-within:border-border"
                      : `rounded-3xl border-border/80 bg-background/95 ${desktop ? "shadow-sm" : ""}`
                  }`
            }
            style={
              footerInput
                ? {
                    paddingInline:
                      "max(16px, env(safe-area-inset-left), env(safe-area-inset-right))",
                    paddingBottom: keyboardOpen
                      ? 8
                      : "max(8px, env(safe-area-inset-bottom))",
                  }
                : undefined
            }
          >
            {(quote || pendingTarget) && showQuote && (
              <div
                className="mx-3 mt-1 flex items-center gap-2"
                data-testid="note-quote"
              >
                <span
                  className="min-w-0 flex-1 truncate border-l-[3px] py-1 pl-2 text-xs text-muted-foreground"
                  style={{
                    borderColor:
                      !quote || quote.color === "invisible"
                        ? "var(--muted-foreground)"
                        : `var(--${quote.color}-secondary)`,
                  }}
                >
                  {quote?.selectedText ?? "Unquoted note"}
                </span>
                {!editingInComposer &&
                  (!footerInput ? (
                    <button
                      aria-label="Remove quote"
                      className="flex size-7 items-center justify-center text-muted-foreground"
                      onClick={() => {
                        if (target)
                          notes.change(draft, {
                            kind: "page",
                            anchor: target.anchor,
                          });
                        onClearQuote();
                      }}
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="Note attachment"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
                      >
                        <MoreHorizontal size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {pendingTarget && (
                          <DropdownMenuItem
                            onClick={() => {
                              notes.change(draft, pendingTarget);
                              setPendingTarget(null);
                            }}
                          >
                            Use selected passage
                          </DropdownMenuItem>
                        )}
                        {quote && (
                          <DropdownMenuItem
                            onClick={() => {
                              if (target)
                                notes.change(draft, {
                                  kind: "page",
                                  anchor: target.anchor,
                                });
                              onClearQuote();
                            }}
                          >
                            Remove quote
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ))}
                {footerInput && mobileAnnotation && (
                  <button
                    aria-label="Show highlight tools"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
                    onClick={() => {
                      input.current?.blur();
                      setWriting(false);
                      setShowTools(true);
                    }}
                  >
                    <Palette size={16} />
                  </button>
                )}
              </div>
            )}
            {/* Mobile keeps its existing internal send slot. Desktop reserves space outside the field. */}
            <div
              className={`relative flex items-end gap-1 ${desktop ? "px-3" : "pr-10"}`}
            >
              {!desktop && (
                <button
                  aria-label="Open notebook"
                  aria-expanded={notebook}
                  onClick={() => {
                    input.current?.blur();
                    onActiveChange(true);
                    mobileAnnotation?.close();
                    setPendingTarget(null);
                    setShowTools(false);
                    setNotebook(!notebook);
                  }}
                  className={`${iconButton} relative`}
                  aria-description={`${noteCount} ${noteCount === 1 ? "note" : "notes"} in this book`}
                >
                  <NotebookCountIcon count={noteCount} />
                </button>
              )}
              <NoteTextInput
                ref={inNotebook ? sidebarInput : input}
                autoFocus={
                  desktop
                    ? open && !inNotebook
                    : !notebook && !mobileAnnotation && !hasDraftText
                }
                onFocus={() => {
                  if (desktop || inNotebook) return;
                  setWriting(true);
                  setShowTools(false);
                  if (!mobileAnnotation) return;
                  if (
                    capturedAnnotation.current !== mobileAnnotation.identity
                  ) {
                    capturedAnnotation.current = mobileAnnotation.identity;
                    const selectedTarget = mobileAnnotation.captureTarget();
                    if (selectedTarget) {
                      if (
                        hasDraftText &&
                        target &&
                        !sameNotePassage(target, selectedTarget)
                      )
                        setPendingTarget(selectedTarget);
                      else {
                        setPendingTarget(null);
                        if (!hasDraftText) notes.change(draft, selectedTarget);
                      }
                    }
                  }
                  onActiveChange(true);
                }}
                aria-label={editingInComposer ? "Edit note" : "Write a note"}
                placeholder="Write a note…"
                value={draft}
                disabled={!notes.ready || inlineEditing}
                readOnly={notes.saving}
                rows={1}
                onChange={(event) => {
                  const nextTarget =
                    target ?? resolver.capture(pagination.spread);
                  if (nextTarget) notes.change(event.target.value, nextTarget);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    send();
                  }
                  if (event.key === "Escape") {
                    if (notes.editingId) void notes.cancelEdit();
                    else close();
                  }
                }}
                className={`${desktop ? "min-h-8 text-sm" : "min-h-8 text-base"} min-w-0 flex-1 resize-none bg-transparent py-1 leading-6 outline-none placeholder:text-muted-foreground`}
              />
              {!desktop && sendButton}
            </div>
          </div>
          {desktop && (
            <div
              className={`mb-[5px] shrink-0 overflow-hidden ${hasDraftText ? "ml-2 w-8" : "w-0"}`}
            >
              {sendButton}
            </div>
          )}
        </div>
      </div>
    );
  }
  const NotebookCard = desktop ? DesktopNotebookNote : NotebookNote;
  const notebookPanel = useMemo(
    () => (
      <motion.section
        key="notebook"
        initial={
          desktop || embeddedNotebook
            ? false
            : {
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(12px)",
              }
        }
        animate={{ opacity: 1, transform: "none" }}
        exit={
          desktop || embeddedNotebook
            ? undefined
            : {
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(12px)",
              }
        }
        transition={desktop || embeddedNotebook ? { duration: 0 } : transition}
        aria-label="Book notebook"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <header className="flex items-center gap-3 px-4 py-2">
          <h2 className="flex flex-1 items-center gap-2 text-sm font-medium">
            <span>Notebook</span>{" "}
            <span className="text-xs font-normal text-muted-foreground font-numeric tabular-nums">
              {entries.length}
            </span>
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Notebook order"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={order} onValueChange={changeOrder}>
                <DropdownMenuRadioItem value="time">
                  By time
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="chapter">
                  By chapter
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {!desktop && (
            <button
              aria-label="Close notebook"
              onClick={() => setNotebook(false)}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X size={15} />
            </button>
          )}
        </header>
        <div
          ref={list}
          className={`relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4 ${desktop ? "flex-1" : ""}`}
          style={{
            minHeight: "min(9rem, 24dvh)",
            maxHeight: desktop ? undefined : keyboardOpen ? "24dvh" : "48dvh",
          }}
        >
          {!entries.length && (
            <motion.p
              initial={desktop ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...transition, delay: reduceMotion ? 0 : 0.16 }}
              className="absolute inset-x-4 top-4 px-4 py-10 text-center font-serif text-lg text-muted-foreground"
            >
              Write your first note below. Your thoughts and saved quotes will
              appear here.
            </motion.p>
          )}
          <AnimatePresence key={order} initial={false}>
            {orderedEntries.flatMap((entry, index) => [
              ...(index === 0 ||
              groupLabel(orderedEntries[index - 1]) !== groupLabel(entry)
                ? [
                    <motion.div
                      key={`heading:${order}:${order === "chapter" ? entry.chapterIndex : new Date(entry.createdAt).toDateString()}`}
                      initial={
                        restoredEntries.current.has(entry.id)
                          ? { height: reduceMotion ? "auto" : 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{
                        height: reduceMotion ? "auto" : 0,
                        opacity: 0,
                        transition: {
                          height: {
                            duration: reduceMotion ? 0 : 0.18,
                            delay: reduceMotion ? 0 : 0.16,
                          },
                          opacity: { duration: 0.16 },
                        },
                      }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.18,
                        ease: transition.ease,
                      }}
                      className="overflow-hidden"
                    >
                      <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                        {groupLabel(entry)}
                      </h3>
                    </motion.div>,
                  ]
                : []),
              <motion.div
                key={entry.id}
                data-note-id={entry.id}
                initial={
                  restoredEntries.current.has(entry.id)
                    ? { height: reduceMotion ? "auto" : 0, opacity: 0 }
                    : false
                }
                animate={{ height: "auto", opacity: 1 }}
                exit={{
                  height: reduceMotion ? "auto" : 0,
                  opacity: 0,
                  transition: {
                    height: {
                      duration: reduceMotion ? 0 : 0.18,
                      delay: reduceMotion ? 0 : 0.16,
                      ease: transition.ease,
                    },
                    opacity: { duration: 0.16 },
                  },
                }}
                transition={{
                  duration: reduceMotion ? 0 : 0.18,
                  ease: transition.ease,
                }}
                className="flow-root overflow-hidden"
              >
                <NotebookCard
                  text={entry.text}
                  dimmed={inlineEditing && notes.editingId !== entry.id}
                  disabled={!notes.ready || notes.saving}
                  canEdit={entry.kind === "note"}
                  editing={notes.editingId === entry.id}
                  onEdit={() => void startEdit(entry.id)}
                  onDelete={() => deleteNote(entry.id)}
                >
                  {entry.quote && (
                    <blockquote
                      className="mb-2 whitespace-pre-wrap break-words border-l-[3px] pl-2 text-xs leading-relaxed text-muted-foreground"
                      style={{
                        borderColor:
                          entry.quote.color === "invisible"
                            ? "var(--muted-foreground)"
                            : `var(--${entry.quote.color}-secondary)`,
                      }}
                    >
                      {entry.quote.selectedText}
                    </blockquote>
                  )}
                  <NotebookNoteBody
                    content={entry.text}
                    edit={
                      desktop && notes.editingId === entry.id
                        ? {
                            value: notes.draft?.content ?? "",
                            saving: notes.saving,
                            onChange: (value) => {
                              if (notes.draft)
                                notes.change(value, notes.draft.target);
                            },
                            onSave: notes.send,
                            onCancel: () => {
                              void notes.cancelEdit();
                            },
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                      <button
                        disabled={!entry.location.page}
                        className="min-w-0 truncate text-left hover:text-foreground"
                        onClick={() => {
                          onVisit(entry.location.page);
                          close();
                        }}
                      >
                        {order === "time" ? `${entry.location.chapter} · ` : ""}
                        {entry.location.page
                          ? `p. ${entry.location.page}`
                          : "Location unavailable"}
                      </button>
                      <time
                        dateTime={new Date(entry.createdAt).toISOString()}
                        title={new Date(entry.createdAt).toLocaleString()}
                        className="shrink-0"
                      >
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  </NotebookNoteBody>
                </NotebookCard>
              </motion.div>,
            ])}
          </AnimatePresence>
        </div>
      </motion.section>
    ),
    [
      entries,
      restoredEntries,
      orderedEntries,
      startEdit,
      deleteNote,
      notes,
      inlineEditing,
      NotebookCard,
      order,
      desktop,
      embeddedNotebook,
      keyboardOpen,
      close,
      onVisit,
      reduceMotion,
      groupLabel,
      setNotebook,
    ],
  );
  return (
    <>
      {!desktop && !embeddedNotebook && (
        <ReaderSheet
          open={notebook && open}
          onOpenChange={setNotebook}
          title="Notebook"
          showHeader={false}
          bodyClassName="flex min-h-0 flex-col"
        >
          {notebookPanel}
          <div className="shrink-0 px-4 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
            {renderNoteInput(true)}
          </div>
        </ReaderSheet>
      )}
      {children(
        <div className="flex h-full min-h-0 flex-col">
          {(desktop || embeddedNotebook) && notebookPanel}
          {(desktop || embeddedNotebook) && (
            <div
              className={
                desktop
                  ? "shrink-0 p-(--sidebar-panel-content-inset)"
                  : "shrink-0 p-4"
              }
            >
              {renderNoteInput(true)}
            </div>
          )}
        </div>,
      )}
      {margin.enabled && !notebook && (
        <aside
          aria-label="Page margin notes"
          className="fixed z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto"
          style={{
            left: commentLeft,
            width: commentWidth,
            top: Math.max(
              80,
              Math.min(
                marginEntries[0]?.top ?? commentPosition.top,
                window.innerHeight - 220,
              ),
            ),
          }}
        >
          {margin.width >= 220
            ? marginEntries.map((entry, index) => (
                <article
                  key={entry.id}
                  data-margin-note
                  style={{ marginTop: index === 0 ? 0 : 8 }}
                  className={commentSurface}
                >
                  {entry.quote && (
                    <blockquote
                      className="mb-2 truncate border-l-[3px] pl-2 text-xs text-muted-foreground"
                      style={{
                        borderColor:
                          entry.quote.color === "invisible"
                            ? "var(--muted-foreground)"
                            : `var(--${entry.quote.color}-secondary)`,
                      }}
                    >
                      {entry.quote.selectedText}
                    </blockquote>
                  )}
                  <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words leading-6">
                    {entry.text}
                  </p>
                </article>
              ))
            : marginEntries.length > 0 && (
                <button
                  aria-label="Read margin notes"
                  onClick={() => {
                    setNotebook(true);
                    onActiveChange(true);
                  }}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {marginEntries.length}
                </button>
              )}
          {desktop && open && margin.width >= 220 && (
            <div
              ref={composer}
              data-note-composer
              className={marginEntries.length ? "mt-2" : ""}
            >
              {renderNoteInput()}
            </div>
          )}
        </aside>
      )}
      <AnimatePresence
        onExitComplete={() => {
          if (!composerOpen || notebook) onMobileComposerPresenceChange(false);
        }}
      >
        {composerOpen && !notebook && (!desktop || margin.width < 220) && (
          <motion.div
            ref={composer}
            data-note-composer
            key="composer"
            initial={{
              opacity: 0,
              transform: reduceMotion ? "none" : "translateY(8px)",
            }}
            animate={{ opacity: 1, transform: "none" }}
            exit={{
              opacity: 0,
              transform: reduceMotion ? "none" : "translateY(8px)",
            }}
            transition={transition}
            className={
              desktop
                ? "fixed z-40 max-h-[calc(100dvh-7rem)] overflow-y-auto"
                : "fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/88 backdrop-blur-xl"
            }
            style={
              desktop
                ? {
                    top: Math.max(
                      80,
                      Math.min(commentPosition.top, window.innerHeight - 220),
                    ),
                    left: commentLeft,
                    width: commentWidth,
                  }
                : undefined
            }
          >
            {mobileAnnotation &&
              !mobileContextVisible &&
              mobileAnnotation.tools}
            {renderNoteInput()}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** The sheet mounts in a portal after its parent. Size the actual input at its
 * own mount, and keep its ref separate from the composer that is still exiting.
 */
function NoteTextInput({
  ref,
  value,
  ...props
}: ComponentProps<"textarea"> & {
  ref: RefObject<HTMLTextAreaElement | null>;
}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [ref, value]);
  return <textarea {...props} ref={ref} value={value} />;
}

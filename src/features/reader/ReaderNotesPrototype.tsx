import { toast } from "sonner";
import { NotebookNote } from "./NotebookNote";
import { ReaderSheet } from "./shared/ReaderSheet";
import type { NoteTarget } from "@/types/note";
import { useReaderNotes } from "./hooks/use-reader-notes";
import { createNoteLocationResolver, noteMarginTop } from "./note-locations";
import type {
  ReaderSessionState,
  ReaderSessionResources,
} from "./hooks/use-reader-session";
import type { ChapterEntry } from "./types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, BookOpen, Check, SlidersHorizontal, X } from "lucide-react";
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
  onVisit,
  margin,
  desktop,
  commentPosition,
  quote: incomingTarget,
  onClearQuote,
}: {
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
  quote: NoteTarget | null;
  onClearQuote: () => void;
  margin: { width: number; location: Location; enabled: boolean };
  location: Location;
  open: boolean;
  onActiveChange: (active: boolean) => void;
  onVisit: (page: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [animateSend, setAnimateSend] = useState(true);
  const [order, setOrder] = useState<"time" | "book">("time");
  const notes = useReaderNotes(bookId);
  const draft = notes.draft?.content ?? "";
  const target = notes.draft?.target;
  const editedNote = useMemo(
    () =>
      notes.editingId
        ? notes.notes.find((note) => note.id === notes.editingId)
        : undefined,
    [notes.notes, notes.editingId],
  );
  const editQuote = editedNote?.kind === "note" ? editedNote.quote : undefined;
  const quote = editQuote
    ? { selectedText: editQuote.text, color: editQuote.color }
    : target?.kind === "highlight"
      ? { selectedText: target.quote.text, color: target.quote.color }
      : target?.kind === "selection"
        ? { selectedText: target.text, color: "invisible" }
        : null;
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
      !incomingTarget ||
      handledTarget.current === incomingTarget
    )
      return;
    handledTarget.current = incomingTarget;
    notes.change(draft, incomingTarget);
    onClearQuote();
  }, [incomingTarget, notes.ready, draft, notes, onClearQuote]);
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
    setOrder(value === "book" ? "book" : "time");
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
    if (!open || desktop || notebook || !element || !viewport) return;
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
  }, [open, desktop, notebook]);

  // Desktop keeps its panel mounted for the sidebar exit. Focus only when
  // the notebook opens; ordinary edits and the exit must not move focus.
  useLayoutEffect(() => {
    if (desktop && open && notebook)
      sidebarInput.current?.focus({ preventScroll: true });
  }, [desktop, open, notebook]);

  useLayoutEffect(() => {
    if (notebook) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [entries.length, notebook]);

  const flush = notes.flush;
  const close = useCallback(() => {
    void flush().catch(() => {});
    sidebarInput.current?.blur();
    input.current?.blur();
    setNotebook(false);
    onActiveChange(false);
    setKeyboardOpen(false);
  }, [flush, setNotebook, onActiveChange]);
  async function send(animate = true) {
    setAnimateSend(animate && !notes.editingId);
    if (!(await notes.send())) return;
    onClearQuote();
    if (desktop && !notebook) close();
    else (notebook ? sidebarInput : input).current?.focus();
  }

  const editNote = notes.edit;
  const startEdit = useCallback(
    async (id: string) => {
      // Focus within the user event so iOS can open the keyboard before the draft read.
      (notebook ? sidebarInput : input).current?.focus();
      if (!(await editNote(id))) return;
      onActiveChange(true);
      (notebook ? sidebarInput : input).current?.focus();
    },
    [editNote, notebook, onActiveChange],
  );

  const removeNote = notes.remove;
  const restoreNote = notes.restore;
  const deleteNote = useCallback(
    async (id: string) => {
      if (!(await removeNote(id))) return;
      const toastId = toast("Note deleted", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: (event) => {
            event.preventDefault();
            void restoreNote(id)
              .then(() => toast.dismiss(toastId))
              .catch(() => {
                toast.error("Could not restore the note. Try Undo again.");
              });
          },
        },
      });
    },
    [removeNote, restoreNote],
  );

  const iconButton =
    "flex h-8 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const latest = entries.at(-1);
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
      if (order === "book") return entry.location.chapter;
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
  const commentWidth = Math.min(260, Math.max(180, margin.width - 32));
  const commentLeft = `calc(100% - ${Math.max(commentWidth + 16, margin.width - 16)}px)`;
  const commentSurface =
    "rounded-xl border border-border/80 bg-background/95 p-3 text-sm shadow-sm";
  function renderNoteInput(inNotebook = false) {
    return (
      <div>
        {notes.editingId && (
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
          className={
            desktop
              ? `relative z-10 ${commentSurface}`
              : "relative z-10 rounded-[2rem] border border-border/80 bg-background/95 p-1 shadow-lg backdrop-blur-xl"
          }
        >
          {quote && (
            <div
              className="mx-3 mt-1 flex items-center gap-2"
              data-testid="note-quote"
            >
              <span
                className="min-w-0 flex-1 truncate border-l-[3px] py-1 pl-2 text-xs text-muted-foreground"
                style={{
                  borderColor:
                    quote.color === "invisible"
                      ? "var(--muted-foreground)"
                      : `var(--${quote.color}-secondary)`,
                }}
              >
                {quote.selectedText}
              </span>
              {!notes.editingId && (
                <button
                  aria-label="Remove quote"
                  onClick={() => {
                    if (target)
                      notes.change(draft, {
                        kind: "page",
                        anchor: target.anchor,
                      });
                    onClearQuote();
                  }}
                  className="flex size-7 items-center justify-center text-muted-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <div className="flex items-end gap-1">
            {!desktop && (
              <button
                aria-label="Open notebook"
                aria-expanded={notebook}
                onClick={() => {
                  input.current?.blur();
                  setNotebook(!notebook);
                }}
                className={iconButton}
              >
                <BookOpen size={19} />
              </button>
            )}
            <NoteTextInput
              ref={inNotebook ? sidebarInput : input}
              autoFocus={desktop ? open : !notebook}
              aria-label={notes.editingId ? "Edit note" : "Write a note"}
              placeholder="Write a note…"
              value={draft}
              disabled={!notes.ready}
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
                  send(false);
                }
                if (event.key === "Escape") {
                  if (notes.editingId) void notes.cancelEdit();
                  else close();
                }
              }}
              className={`${desktop ? "min-h-8 text-sm" : "min-h-8 text-base"} min-w-0 flex-1 resize-none bg-transparent py-1 leading-6 outline-none placeholder:text-muted-foreground/70`}
            />
            <button
              aria-label={notes.editingId ? "Save changes" : "Save note"}
              disabled={!notes.ready || notes.saving || !draft.trim()}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => send()}
              className="mb-0.5 flex h-7 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              {notes.editingId ? <Check size={20} /> : <ArrowUp size={20} />}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const notebookPanel = useMemo(
    () => (
      <motion.section
        key="notebook"
        initial={{
          opacity: 0,
          transform: reduceMotion ? "none" : "translateY(12px)",
        }}
        animate={{ opacity: 1, transform: "none" }}
        exit={{
          opacity: 0,
          transform: reduceMotion ? "none" : "translateY(12px)",
        }}
        transition={transition}
        aria-label="Book notebook"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <header className="flex items-center gap-3 px-4 py-2">
          <h2 className="flex-1 text-sm font-medium">
            Notebook{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
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
                <DropdownMenuRadioItem value="book">
                  By book
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label="Close notebook"
            onClick={() => (desktop ? close() : setNotebook(false))}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={15} />
          </button>
        </header>
        <div
          ref={list}
          className={`min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4 ${desktop ? "flex-1" : ""}`}
          style={{
            maxHeight: desktop ? undefined : keyboardOpen ? "24dvh" : "48dvh",
          }}
        >
          {!entries.length && (
            <p className="px-4 py-10 text-center font-serif text-lg text-muted-foreground">
              A place for what stays with you.
            </p>
          )}
          {orderedEntries.map((entry, index) => (
            <div key={entry.id} data-note-id={entry.id}>
              {(index === 0 ||
                groupLabel(orderedEntries[index - 1]) !==
                  groupLabel(entry)) && (
                <h3 className="mb-2 mt-4 px-1 text-xs font-medium text-muted-foreground first:mt-0">
                  {groupLabel(entry)}
                </h3>
              )}
              <NotebookNote
                disabled={!notes.ready || notes.saving}
                canEdit={entry.kind === "note"}
                editing={notes.editingId === entry.id}
                onEdit={() => void startEdit(entry.id)}
                onDelete={() => void deleteNote(entry.id)}
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
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  {entry.text}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
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
              </NotebookNote>
            </div>
          ))}
        </div>
      </motion.section>
    ),
    [
      entries,
      orderedEntries,
      startEdit,
      deleteNote,
      notes.ready,
      notes.saving,
      notes.editingId,
      order,
      desktop,
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
      {notes.error && (
        <p
          role="alert"
          className="fixed inset-x-4 top-16 z-50 rounded-xl bg-background p-3 text-sm"
        >
          {notes.error}
        </p>
      )}
      {!desktop && (
        <ReaderSheet
          open={notebook && open}
          onOpenChange={setNotebook}
          title="Notebook"
          showHeader={false}
          bodyClassName="flex min-h-0 flex-col"
        >
          {notebookPanel}
          <div className="shrink-0 px-2 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
            {renderNoteInput(true)}
          </div>
        </ReaderSheet>
      )}
      {children(
        <div className="flex h-full min-h-0 flex-col">
          {desktop && notebookPanel}
          {desktop && (
            <div className="shrink-0 p-2">{renderNoteInput(true)}</div>
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
      <AnimatePresence>
        {open && !notebook && (!desktop || margin.width < 220) && (
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
                : "fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[32rem]"
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
                : {
                    paddingInline: keyboardOpen
                      ? "max(6px, env(safe-area-inset-left), env(safe-area-inset-right))"
                      : 12,
                    paddingBottom: keyboardOpen
                      ? 0
                      : "max(8px, calc(env(safe-area-inset-bottom) - 12px))",
                  }
            }
          >
            {!desktop && !notebook && latest && !notes.editingId && (
              <div
                className="relative mx-4 -mb-3 h-10 overflow-hidden"
                aria-live="polite"
              >
                <motion.button
                  key={latest.id}
                  aria-label="Read latest note"
                  onClick={() => {
                    input.current?.blur();
                    setNotebook(true);
                  }}
                  initial={{
                    opacity: 0,
                    transform:
                      reduceMotion || !animateSend
                        ? "none"
                        : "translateY(10px)",
                  }}
                  animate={{ opacity: 1, transform: "none" }}
                  transition={{
                    ...transition,
                    duration: animateSend ? 0.18 : 0,
                  }}
                  className="absolute inset-0 flex w-full items-center gap-2 rounded-[2rem] border border-border/50 bg-background/90 px-3 pb-2 text-left text-xs text-muted-foreground backdrop-blur-xl"
                >
                  <span
                    className="min-w-0 flex-1 truncate"
                    aria-label={latest.text}
                  >
                    <span aria-hidden="true">
                      {Array.from(latest.text.slice(0, 90)).map(
                        (character, index) => (
                          <motion.span
                            key={index}
                            className="inline-block whitespace-pre"
                            initial={
                              reduceMotion || !animateSend
                                ? false
                                : { opacity: 0, transform: "translateY(4px)" }
                            }
                            animate={{ opacity: 1, transform: "none" }}
                            transition={{
                              duration: 0.12,
                              delay:
                                reduceMotion || !animateSend
                                  ? 0
                                  : Math.min(index, 50) * 0.003,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                          >
                            {character}
                          </motion.span>
                        ),
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px]">
                    {new Date(latest.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </motion.button>
              </div>
            )}
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

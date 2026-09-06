import { ReaderSheet } from "./shared/ReaderSheet";
import type { Highlight } from "@/types/highlight";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, BookOpen, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Location {
  page: number;
  chapter: string;
}
interface Entry {
  id: number;
  text: string;
  location: Location;
  createdAt: number;
  quote?: Highlight;
  top: number;
}

/** Temporary, book-scoped notebook. Nothing is written to storage or sync. */
export function ReaderNotesPrototype({
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
  quote,
  onClearQuote,
}: {
  children: (panel: ReactNode) => ReactNode;
  notebook: boolean;
  setNotebook: (open: boolean) => void;
  commentPosition: { top: number; page: number };
  desktop: boolean;
  quote: Highlight | null;
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
  const [draft, setDraft] = useState("");
  const [anchor, setAnchor] = useState(location);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const marginAnchor = useRef<Location | null>(null);
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

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [draft, open, notebook]);

  useLayoutEffect(() => {
    if (notebook) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [entries.length, notebook]);

  function close() {
    input.current?.blur();
    setNotebook(false);
    onActiveChange(false);
    setKeyboardOpen(false);
  }
  function send(animate = true) {
    setAnimateSend(animate);
    if (!draft.trim()) return;
    setEntries((previous) => [
      ...previous,
      {
        id: nextId.current++,
        text: draft.trim(),
        location: anchor,
        top: commentPosition.top,
        createdAt: Date.now(),
        ...(quote ? { quote: { ...quote } } : {}),
      },
    ]);
    onClearQuote();
    marginAnchor.current = null;
    setDraft("");
    setAnchor(location);
    if (desktop && !notebook) close();
    else input.current?.focus();
  }

  const iconButton =
    "flex h-8 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const latest = entries.at(-1);
  const orderedEntries =
    order === "time"
      ? entries
      : [...entries].sort(
          (a, b) =>
            a.location.page - b.location.page ||
            a.createdAt - b.createdAt ||
            a.id - b.id,
        );
  const groupLabel = (entry: Entry) => {
    if (order === "book") return entry.location.chapter;
    const date = new Date(entry.createdAt);
    if (date.toDateString() === new Date().toDateString()) return "Today";
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  const transition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const };
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
  const noteInput = (
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
          <button
            aria-label="Remove quote"
            onClick={onClearQuote}
            className="flex size-7 items-center justify-center text-muted-foreground"
          >
            <X size={13} />
          </button>
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
        <textarea
          ref={input}
          autoFocus={!notebook}
          aria-label="Write a note"
          placeholder="Write a note…"
          value={draft}
          rows={1}
          onChange={(event) => {
            if (!draft) setAnchor(marginAnchor.current ?? location);
            setDraft(event.target.value);
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
            if (event.key === "Escape") close();
          }}
          className={`${desktop ? "min-h-8 text-sm" : "min-h-8 text-base"} min-w-0 flex-1 resize-none bg-transparent py-1 leading-6 outline-none placeholder:text-muted-foreground/70`}
        />
        <button
          aria-label="Save note"
          disabled={!draft.trim()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => send()}
          className="mb-0.5 flex h-7 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
        >
          <ArrowUp size={20} />
        </button>
      </div>
    </div>
  );
  const notebookPanel = (
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
        className={`min-h-0 overflow-y-auto overscroll-contain p-4 ${desktop ? "flex-1" : ""}`}
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
              groupLabel(orderedEntries[index - 1]) !== groupLabel(entry)) && (
              <h3 className="mb-2 mt-4 px-1 text-xs font-medium text-muted-foreground first:mt-0">
                {groupLabel(entry)}
              </h3>
            )}
            <article className="mb-2 rounded-2xl bg-secondary/45 px-4 py-3">
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
                  className="min-w-0 truncate text-left hover:text-foreground"
                  onClick={() => {
                    onVisit(entry.location.page);
                    close();
                  }}
                >
                  {order === "time" ? `${entry.location.chapter} · ` : ""}
                  p. {entry.location.page}
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
            </article>
          </div>
        ))}
      </div>
      <p className="px-4 pb-2 text-[10px] text-muted-foreground">
        Prototype · notes stay here until you leave this book.
      </p>
    </motion.section>
  );
  return (
    <>
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
            {noteInput}
          </div>
        </ReaderSheet>
      )}
      {children(
        <div className="flex h-full min-h-0 flex-col">
          {desktop && notebook && notebookPanel}
          {desktop && notebook && (
            <div className="shrink-0 p-2">{noteInput}</div>
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
              {noteInput}
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
            {!desktop && !notebook && latest && (
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
            {noteInput}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

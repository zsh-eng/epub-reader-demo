import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUp,
  BookOpen,
  SlidersHorizontal,
  MessageSquare,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Location {
  page: number;
  chapter: string;
}
interface Entry {
  id: number;
  text: string;
  location: Location;
  createdAt: number;
}

/** Temporary, book-scoped notebook. Nothing is written to storage or sync. */
export function ReaderNotesPrototype({
  location,
  open,
  onActiveChange,
  onVisit,
  margin,
}: {
  margin: { width: number; location: Location; enabled: boolean };
  location: Location;
  open: boolean;
  onActiveChange: (active: boolean) => void;
  onVisit: (page: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [animateSend, setAnimateSend] = useState(true);
  const [notebook, setNotebook] = useState(false);
  const [order, setOrder] = useState<"time" | "book">("time");
  const [draft, setDraft] = useState("");
  const [anchor, setAnchor] = useState(location);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [keyboardInset, setKeyboardInset] = useState(0);
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

  // Follow the visual viewport, without resizing the paginated reading surface.
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () =>
      setKeyboardInset(
        Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop),
      );
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [draft, open]);

  useLayoutEffect(() => {
    if (notebook) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [entries.length, notebook]);

  function close() {
    setNotebook(false);
    onActiveChange(false);
    setKeyboardInset(0);
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
        createdAt: Date.now(),
      },
    ]);
    marginAnchor.current = null;
    setDraft("");
    setAnchor(location);
    input.current?.focus();
  }

  const iconButton =
    "flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const latest = entries.at(-1);
  const keyboardOpen = keyboardInset > 100;
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
    (entry) => entry.location.page === margin.location.page,
  );
  return (
    <>
      {margin.enabled && !open && (
        <aside
          aria-label="Page margin notes"
          className="fixed right-2 top-28 z-20"
          style={{ width: Math.max(24, margin.width - 16) }}
        >
          <button
            aria-label="Add margin note"
            title={`Note on page ${margin.location.page}`}
            onClick={() => {
              if (!draft) marginAnchor.current = margin.location;
              onActiveChange(true);
            }}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <MessageSquare size={15} />
          </button>
          {margin.width >= 220
            ? marginEntries.map((entry) => (
                <p
                  key={entry.id}
                  className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/95 p-3 text-sm leading-relaxed"
                >
                  {entry.text}
                </p>
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
        </aside>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
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
            className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[28rem]"
            style={{
              bottom: keyboardInset,
              paddingInline: keyboardOpen
                ? "max(6px, env(safe-area-inset-left), env(safe-area-inset-right))"
                : 24,
              paddingBottom: keyboardOpen
                ? 4
                : "max(8px, calc(env(safe-area-inset-bottom) - 12px))",
            }}
          >
            <AnimatePresence>
              {notebook && (
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
                  className="mb-2 overflow-hidden rounded-3xl border border-border bg-background/95 shadow-lg backdrop-blur-xl"
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
                        <DropdownMenuRadioGroup
                          value={order}
                          onValueChange={changeOrder}
                        >
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
                      onClick={() => setNotebook(false)}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <X size={15} />
                    </button>
                  </header>
                  <div
                    ref={list}
                    className="overflow-y-auto overscroll-contain p-4"
                    style={{ maxHeight: keyboardInset > 0 ? "24dvh" : "48dvh" }}
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
                        <article className="mb-2 rounded-2xl bg-secondary/45 px-4 py-3">
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
                              {order === "time"
                                ? `${entry.location.chapter} · `
                                : ""}
                              p. {entry.location.page}
                            </button>
                            <time
                              dateTime={new Date(entry.createdAt).toISOString()}
                              title={new Date(entry.createdAt).toLocaleString()}
                              className="shrink-0"
                            >
                              {new Date(entry.createdAt).toLocaleTimeString(
                                [],
                                {
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )}
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
              )}
            </AnimatePresence>
            {!notebook && latest && (
              <div
                className="relative mx-3 -mb-4 h-16 overflow-hidden"
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
                  className="absolute inset-0 flex w-full items-center gap-2 rounded-[2rem] border border-border/50 bg-background/90 px-4 pb-4 text-left text-xs text-muted-foreground backdrop-blur-xl"
                >
                  <span className="min-w-0 flex-1 truncate">{latest.text}</span>
                  <span className="shrink-0 text-[10px]">
                    {new Date(latest.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </motion.button>
              </div>
            )}
            <div className="relative z-10 rounded-[2rem] border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur-xl">
              <div className="flex items-end gap-1">
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
                <textarea
                  ref={input}
                  autoFocus
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
                  className="min-h-10 flex-1 resize-none bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground/70"
                />
                <button
                  aria-label="Save note"
                  disabled={!draft.trim()}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => send()}
                  className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
                >
                  <ArrowUp size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

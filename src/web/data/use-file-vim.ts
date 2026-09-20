import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import VimSearchWorker from "./vim-search.worker?worker";
import { MAX_VIM_MATCHES, VimNavigation } from "./vim-navigation";

type SearchResult = { identity: string; message: string; query: string; wholeWord: boolean };
type SearchSession = {
  line: number;
  column: number;
  desired: number;
  scrollTop: number;
  query: string;
  direction: 1 | -1;
  matches: number[];
  result: SearchResult;
};
export type FileNavigationCommand = (key: string, control?: boolean) => void;
/** Imperative cursor painting keeps movement out of React and Pierre tokenization. */
export function useFileVim({
  text,
  identity,
  enabled,
  viewer,
  line,
  column,
  onNavigationReady,
}: {
  text: string;
  identity: string;
  enabled: boolean;
  viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
  line?: number;
  column?: number;
  onNavigationReady?: (command: FileNavigationCommand | null) => void;
}) {
  const model = useMemo(() => new VimNavigation(text, identity), [text, identity]);
  const pane = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const paintPending = useRef(false);
  const currentPaint = useRef<() => void>(() => {});
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const restoreFocus = useRef(false);
  const restoreScroll = useRef<number | null>(null);
  const session = useRef<SearchSession | null>(null);
  const [highlightsVisible, setHighlightsVisible] = useState(true);
  const [searchState, setSearch] = useState<{
    identity: string;
    direction: 1 | -1;
    query: string;
  } | null>(null);
  const search = searchState?.identity === model.identity ? searchState : null;
  const [result, setResult] = useState<SearchResult>({
    identity: "",
    message: "",
    query: "",
    wholeWord: false,
  });
  const message = result.identity === identity ? result.message : "";
  const highlightQuery = highlightsVisible && result.identity === identity ? result.query : "";
  const paint = useCallback(
    (align?: "start" | "center" | "end" | "nearest") => {
      const element = caret.current,
        container = pane.current;
      if (!element || !container) return;
      container.dataset.vimLine = String(model.line + 1);
      container.dataset.vimColumn = String(model.column + 1);
      if (!align && !active.current) {
        element.hidden = true;
        return;
      }
      const instance = viewer.current?.getInstance();
      const mounted = host.current?.shadowRoot?.querySelector<HTMLElement>(
        `[data-line="${model.line + 1}"]`,
      );
      const visibleBounds = instance?.getContainerElement()?.getBoundingClientRect();
      const lineBounds = mounted?.getBoundingClientRect();
      const needsScroll =
        !lineBounds ||
        !visibleBounds ||
        lineBounds.top < visibleBounds.top ||
        lineBounds.bottom > visibleBounds.bottom;
      if (align && instance && (align !== "nearest" || needsScroll)) {
        const lineHeight = lineBounds?.height || 20;
        const edgeSpace = Math.min(
          4 * lineHeight,
          Math.max(0, ((visibleBounds?.height ?? container.clientHeight) - lineHeight) / 2),
        );
        instance.scrollTo({
          type: "line",
          id: identity,
          lineNumber: model.line + 1,
          align,
          offset: align === "start" || align === "end" ? edgeSpace : 0,
          behavior: "instant",
        });
        // Let Pierre coalesce pending navigation before its next render. Initial
        // file positioning still uses a synchronous flush in FullFileView.
        element.hidden = true;
        // An already-aligned or clamped scroll can leave the DOM unchanged.
        // Repaint even when Pierre has no new rows to report.
        if (align !== "nearest") requestAnimationFrame(() => currentPaint.current());
        return;
      }
      container.dataset.vimLine = String(model.line + 1);
      container.dataset.vimColumn = String(model.column + 1);
      const row = host.current?.shadowRoot?.querySelector<HTMLElement>(
        `[data-line="${model.line + 1}"]`,
      );
      if (!active.current || !row) {
        element.hidden = true;
        return;
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0,
        first: Text | null = null,
        last: Text | null = null;
      const end = model.column + Math.max(1, model.characterLength);
      const emptyLine = model.characterLength === 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!first && offset + node.length > model.column) {
          first = node;
          range.setStart(node, model.column - offset);
        }
        if (first && offset + node.length >= end) {
          last = node;
          range.setEnd(node, end - offset);
          break;
        }
        offset += node.length;
      }
      const characterBounds = first && last && !emptyLine;
      let bounds = characterBounds ? range.getBoundingClientRect() : row.getBoundingClientRect();
      // Pierre owns a horizontal scroller inside the shadow root. Keep the actual
      // character visible, rather than scrolling the full (potentially wide) row.
      if (align) {
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (
            parent.scrollWidth <= parent.clientWidth ||
            !/auto|scroll/.test(getComputedStyle(parent).overflowX)
          )
            continue;
          const rect = parent.getBoundingClientRect();
          if (bounds.right > rect.right - 12) parent.scrollLeft += bounds.right - rect.right + 12;
          else if (bounds.left < rect.left + 50) parent.scrollLeft -= rect.left + 50 - bounds.left;
          bounds = characterBounds ? range.getBoundingClientRect() : row.getBoundingClientRect();
          break;
        }
      }
      const box = container.getBoundingClientRect();
      const viewport = instance?.getContainerElement()?.getBoundingClientRect() ?? box;
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
        element.hidden = true;
        return;
      }
      // Animate cursor moves only. Scrolling and initial placement stay exact.
      const left = `${bounds.left - box.left}px`;
      const top = `${bounds.top - box.top}px`;
      if (align || element.style.left !== left || element.style.top !== top)
        element.dataset.animate = String(!!align && !element.hidden);
      element.style.font = getComputedStyle(row).font;
      element.style.left = left;
      element.style.top = top;
      element.style.width = characterBounds ? `${Math.max(2, bounds.width)}px` : "1ch";
      element.style.height = `${bounds.height || 20}px`;
      element.dataset.vimLine = String(model.line + 1);
      element.dataset.vimColumn = String(model.column + 1);
      element.hidden = false;
    },
    [identity, model, viewer],
  );
  useLayoutEffect(() => {
    currentPaint.current = paint;
  }, [paint]);
  const runSearch = useCallback(
    (query: string, direction: 1 | -1, wholeWord = false, origin?: SearchSession) => {
      if (!query) return;
      setHighlightsVisible(true);
      setResult({ identity, query, wholeWord, message: "" });
      const id = ++request.current;
      if (!worker.current) {
        worker.current = new VimSearchWorker();
        worker.current.postMessage({ text, id: -1, query: "", wholeWord: false });
      }
      worker.current.onmessage = (event: MessageEvent<{ id: number; matches: Uint32Array }>) => {
        if (event.data.id !== request.current) return;
        // Every incremental query starts at the position where / or ? opened.
        // Refining the query must not advance from the previous preview match.
        if (origin) model.jump(origin.line, origin.column);
        model.setSearch(query, direction);
        model.setMatches(event.data.matches);
        setResult({
          identity,
          query,
          wholeWord,
          message: model.matches.length
            ? `${model.matches.length === MAX_VIM_MATCHES ? "First " : ""}${model.matches.length.toLocaleString()} matches · ${query}`
            : `No matches · ${query}`,
        });
        paint("nearest");
      };
      worker.current.postMessage({ id, query, wholeWord });
    },
    [identity, model, paint, text],
  );
  const beginSearch = useCallback(
    (direction: 1 | -1) => {
      ++request.current;
      session.current = {
        line: model.line,
        column: model.column,
        desired: model.desired,
        scrollTop: viewer.current?.getInstance()?.getScrollTop() ?? 0,
        query: model.query,
        direction: model.direction,
        matches: model.matches,
        result,
      };
      setSearch({ identity: model.identity, direction, query: "" });
    },
    [model, result, viewer],
  );
  const restoreSearchOrigin = () => {
    const origin = session.current;
    if (!origin) return;
    model.restoreSearch(origin);
    setResult(origin.result);
    viewer.current
      ?.getInstance()
      ?.scrollTo({ type: "position", position: origin.scrollTop, behavior: "instant" });
    paint();
  };
  const command = useCallback<FileNavigationCommand>(
    (key, control = false) => {
      active.current = true;
      pane.current?.focus({ preventScroll: true });
      if (key === "Escape") {
        ++request.current;
        setHighlightsVisible(false);
      } else if (key === "n" || key === "N") setHighlightsVisible(true);
      const result = model.key(
        key,
        control,
        Math.max(1, Math.floor((pane.current?.clientHeight ?? 400) / 40)),
      );
      if (result.search) {
        if (result.wordSearch) runSearch(result.wordSearch, result.search, true);
        else beginSearch(result.search);
      }
      if (result.handled) paint(result.align ?? "nearest");
    },
    [model, paint, runSearch, beginSearch],
  );
  useLayoutEffect(() => {
    active.current = enabled && document.activeElement === pane.current;
    paint();
  }, [enabled, paint]);
  useLayoutEffect(() => {
    if (search || !restoreFocus.current) return;
    restoreFocus.current = false;
    pane.current?.focus({ preventScroll: true });
    active.current = enabled;
    if (restoreScroll.current !== null) {
      viewer.current
        ?.getInstance()
        ?.scrollTo({ type: "position", position: restoreScroll.current, behavior: "instant" });
      restoreScroll.current = null;
      paint();
    } else paint("nearest");
  }, [search, enabled, paint, viewer]);
  useEffect(() => {
    onNavigationReady?.(command);
    return () => onNavigationReady?.(null);
  }, [command, onNavigationReady]);
  const stopSearchWorker = useCallback(() => {
    ++request.current;
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useLayoutEffect(() => {
    session.current = null;
    return stopSearchWorker;
  }, [model, stopSearchWorker]);
  useLayoutEffect(() => {
    model.jump((line ?? 1) - 1, (column ?? 1) - 1);
    paint();
  }, [model, line, column, paint]);
  useEffect(() => {
    const element = pane.current;
    if (!element) return;
    const onScroll = () => {
      if (caret.current) caret.current.dataset.animate = "false";
      paint();
    };
    element.addEventListener("scroll", onScroll, true);
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll, true);
      observer.disconnect();
    };
  }, [paint]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.altKey || event.nativeEvent.isComposing)
      return;
    if (
      (event.target as HTMLElement).closest("input,textarea,button,select,[contenteditable=true]")
    )
      return;
    if (event.key === "Escape") {
      ++request.current;
      setHighlightsVisible(false);
      model.key("Escape");
      event.preventDefault();
      return;
    }
    if (!enabled) return;
    if (event.key === "n" || event.key === "N") setHighlightsVisible(true);
    // Probe command recognition without changing state twice.
    const result = model.key(
      event.key,
      event.ctrlKey,
      Math.max(1, Math.floor((pane.current?.clientHeight ?? 400) / 40)),
    );
    if (!result.handled) return;
    event.preventDefault();
    active.current = true;
    if (result.search) {
      if (result.wordSearch) runSearch(result.wordSearch, result.search, true);
      else beginSearch(result.search);
    }
    paint(result.align ?? "nearest");
  };
  const position = useMemo(
    () => ({
      capture() {
        return {
          line: model.line,
          column: model.column,
          desired: model.desired,
          query: model.query,
          direction: model.direction,
          matches: model.matches,
        };
      },
      restore(
        saved: Pick<
          SearchSession,
          "line" | "column" | "desired" | "query" | "direction" | "matches"
        >,
      ) {
        model.restoreSearch(saved);
        paint();
      },
      jump(line: number, column = 1) {
        model.jump(line - 1, column - 1);
        paint("center");
      },
    }),
    [model, paint],
  );
  return {
    position,
    pane,
    caret,
    search,
    updateSearch(query: string) {
      if (!search) return;
      setSearch({ identity: model.identity, direction: search.direction, query });
      if (query) runSearch(query, search.direction, false, session.current ?? undefined);
      else {
        ++request.current;
        setHighlightsVisible(false);
        restoreSearchOrigin();
      }
    },
    message,
    highlightQuery,
    highlightOptions: {
      caseSensitive: /\p{Lu}/u.test(highlightQuery),
      wholeWord: result.identity === identity && result.wholeWord,
    },
    keyDown,
    onFocus() {
      active.current = enabled;
      paint();
    },
    onBlur() {
      active.current = false;
      paint();
    },
    onPostRender(node: HTMLElement, phase: string) {
      host.current = phase === "unmount" ? null : node;
      if (!paintPending.current) {
        paintPending.current = true;
        queueMicrotask(() => {
          paintPending.current = false;
          currentPaint.current();
        });
      }
    },
    submitSearch() {
      if (search) {
        const query = search.query || session.current?.query || "";
        // Accept a completed preview without advancing to the following match.
        if (!search.query || result.query !== query || !result.message)
          runSearch(query, search.direction, false, session.current ?? undefined);
      }
      session.current = null;
      restoreFocus.current = true;
      setSearch(null);
    },
    cancelSearch() {
      ++request.current;
      setHighlightsVisible(false);
      restoreScroll.current = session.current?.scrollTop ?? null;
      restoreSearchOrigin();
      session.current = null;
      restoreFocus.current = true;
      setSearch(null);
    },
    onClick(event: React.MouseEvent<HTMLDivElement>) {
      if (!enabled) return;
      const row = event.nativeEvent
        .composedPath()
        .find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.hasAttribute("data-line"),
        );
      if (!row) return;
      const shadow = host.current?.shadowRoot;
      const position = document.caretPositionFromPoint(event.clientX, event.clientY, {
        shadowRoots: shadow ? [shadow] : [],
      });
      let column = 0;
      if (position && row.contains(position.offsetNode)) {
        const range = document.createRange();
        range.selectNodeContents(row);
        range.setEnd(position.offsetNode, position.offset);
        column = range.toString().length;
      }
      model.jump(Number(row.dataset.line) - 1, column);
      active.current = true;
      pane.current?.focus({ preventScroll: true });
      paint();
    },
  };
}

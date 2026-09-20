import * as stylex from "@stylexjs/stylex";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CodeViewLineSelection } from "@pierre/diffs";
import type { BrowseRead } from "../../shared/browse";
import type { BrowseBlame } from "../../shared/inspect";
import type { BlameLoader } from "../data/blame";
import { tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import "../pierre-theme";
import { Icon } from "./Icon";
import { useFileVim, type FileNavigationCommand } from "../data/use-file-vim";
import { createSearchHighlights } from "../data/search-highlights";

export interface FileSymbolPreview {
  preview(line: number, column: number | undefined, name: string): void;
  finish(accept: boolean): void;
}
export type BeginFileSymbolPreview = () => FileSymbolPreview;

export interface FullFileViewProps {
  file: BrowseRead | null;
  path?: string;
  loading: boolean;
  stale?: boolean;
  error: string | null;
  sourceLabel: string;
  line?: number;
  column?: number;
  vimEnabled?: boolean;
  onSymbolPreviewReady?(begin: BeginFileSymbolPreview | null): void;
  onNavigationReady?(command: FileNavigationCommand | null): void;
  highlightQuery?: string;
  compact?: boolean;
  initialScrollTop?: number;
  onScrollPosition?(top: number): void;
  loadBlame?: BlameLoader;
  blameEnabled?: boolean;
  onBlameEnabledChange?(enabled: boolean): void;
  onRefresh(): void;
  onClose?(): void;
  onOpenBefore?(): void;
  onOpenAfter?(): void;
}

const notices = {
  binary: "Binary file — content preview is not available.",
  missing: "This file does not exist in this source.",
  "too-large": "This file exceeds the preview size limit.",
  unsupported: "This file type or encoding cannot be displayed.",
};

/** One read-only, virtualized file. Metadata responses never reach Pierre. */
export function FullFileView({
  file,
  path,
  loading,
  stale = false,
  error,
  sourceLabel,
  line,
  column,
  vimEnabled = false,
  onNavigationReady,
  onSymbolPreviewReady,
  highlightQuery = "",
  compact = false,
  initialScrollTop,
  onScrollPosition,
  loadBlame,
  blameEnabled,
  onBlameEnabledChange,
  onRefresh,
  onClose,
  onOpenBefore,
  onOpenAfter,
}: FullFileViewProps) {
  const displayPath = path ?? file?.path;
  const { active } = useTheme();
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const vim = useFileVim({
    text: file?.kind === "text" ? (file.text ?? "") : "",
    identity: file?.identity ?? "",
    enabled: vimEnabled && !compact,
    viewer,
    line,
    column,
    onNavigationReady,
  });
  const [symbolHighlight, setSymbolHighlight] = useState<string | null>(null);
  const beginSymbolPreview = useCallback<BeginFileSymbolPreview>(() => {
    const instance = viewer.current?.getInstance();
    const origin = vim.position.capture();
    const scrollTop = instance?.getScrollTop() ?? 0;
    const selected = instance?.getSelectedLines() ?? null;
    return {
      preview(target, targetColumn, name) {
        vim.position.jump(target, targetColumn);
        instance?.setSelectedLines({
          id: file?.identity ?? "",
          range: { start: target, end: target },
        });
        instance?.render(true);
        setSymbolHighlight(name);
      },
      finish(accept) {
        setSymbolHighlight(null);
        if (!accept) {
          vim.position.restore(origin);
          instance?.setSelectedLines(selected);
          instance?.scrollTo({ type: "position", position: scrollTop, behavior: "instant" });
          instance?.render(true);
        }
      },
    };
  }, [vim.position, file?.identity]);
  useLayoutEffect(() => {
    if (compact || file?.kind !== "text" || loading) return;
    onSymbolPreviewReady?.(beginSymbolPreview);
    return () => onSymbolPreviewReady?.(null);
  }, [beginSymbolPreview, compact, file?.kind, loading, onSymbolPreviewReady]);
  // Preview panes must never take focus from the picker input.
  useLayoutEffect(() => {
    if (!compact && !loading && file?.kind === "text")
      vim.pane.current?.focus({ preventScroll: true });
  }, [compact, loading, file?.identity, file?.kind, vim.pane]);
  const effectiveHighlightQuery = symbolHighlight ?? (vim.highlightQuery || highlightQuery);
  const currentHighlightQuery = useRef(effectiveHighlightQuery);
  currentHighlightQuery.current = effectiveHighlightQuery;
  const currentHighlightOptions = useRef(vim.highlightOptions);
  currentHighlightOptions.current =
    symbolHighlight !== null
      ? { caseSensitive: true, wholeWord: true }
      : vim.highlightQuery
        ? vim.highlightOptions
        : { caseSensitive: false, wholeWord: false };
  const vimRender = useRef(vim.onPostRender);
  vimRender.current = vim.onPostRender;
  const highlightId = `med-search-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const highlights = useMemo(() => createSearchHighlights(highlightId), [highlightId]);
  useLayoutEffect(() => {
    highlights.refresh(effectiveHighlightQuery, currentHighlightOptions.current);
  }, [
    highlights,
    effectiveHighlightQuery,
    vim.highlightOptions.wholeWord,
    vim.highlightOptions.caseSensitive,
    symbolHighlight,
  ]);
  useLayoutEffect(() => () => highlights.dispose(), [highlights]);
  const [localBlameEnabled, setLocalBlameEnabled] = useState(false);
  const blameOpen = !compact && (blameEnabled ?? localBlameEnabled);
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const [blame, setBlame] = useState<{
    key: string;
    result?: BrowseBlame;
    error?: string;
  }>({ key: "" });
  const selectedRange = selection?.id === file?.identity ? selection?.range : undefined;
  const startLine = selectedRange
    ? Math.min(selectedRange.start, selectedRange.end)
    : Math.max(1, line ?? 1);
  const selectedEndLine = selectedRange
    ? Math.max(selectedRange.start, selectedRange.end)
    : startLine;
  const endLine = Math.min(selectedEndLine, startLine + 199);
  const blameKey = file
    ? JSON.stringify([file.source, file.path, file.identity, startLine, endLine])
    : "";
  const canBlame = !!loadBlame && file?.kind === "text" && !stale && !loading && !error;
  const currentBlame = blame.key === blameKey ? blame : undefined;
  const setBlameOpen = (open: boolean) => {
    setLocalBlameEnabled(open);
    onBlameEnabledChange?.(open);
  };
  useEffect(() => {
    if (!blameOpen || !canBlame || !file || !loadBlame) return;
    const controller = new AbortController();
    // Delay a little so a drag over line numbers does not start a Git process
    // for each pointer event. Every response is tied to these exact file bytes.
    const timer = setTimeout(() => {
      void loadBlame(file, startLine, endLine, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setBlame({ key: blameKey, result });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setBlame({
              key: blameKey,
              error: cause instanceof Error ? cause.message : "Cannot read line history.",
            });
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [blameOpen, canBlame, file, loadBlame, startLine, endLine, blameKey]);
  const plain = !!file?.plain;
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (file?.kind !== "text" || typeof file.text !== "string") return [];
    return [
      {
        id: file.identity,
        type: "file",
        file: {
          name: file.path,
          contents: file.text,
          cacheKey: `${JSON.stringify(file.source)}:${file.identity}:${plain ? "plain" : "syntax"}`,
          // FileRenderer's isFilePlainText path skips highlightFileAST even with a
          // worker pool. forcePlainText is a lower-level renderer option, not a
          // CodeView option. lang=text is the supported CodeView entry point.
          ...(plain ? { lang: "text" as const } : {}),
        },
      },
    ];
  }, [file, plain]);
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      overflow: "scroll",
      disableFileHeader: true,
      enableLineSelection: true,
      tokenizeMaxLineLength: 1000,
      unsafeCSS: `[data-line] { tab-size: 2; } ::highlight(${highlightId}) { background-color: ${active.palette.warning}; color: ${active.palette.canvas}; }`,
      onPostRender(node, _instance, phase) {
        vimRender.current(node, phase);
        if (phase === "unmount") highlights.dispose();
        else
          highlights.update(node, currentHighlightQuery.current, currentHighlightOptions.current);
      },
      layout: { gap: 0, paddingTop: 8, paddingBottom: 16 },
    }),
    [active, highlightId, highlights],
  );
  useLayoutEffect(() => {
    if (!file || !items.length || loading) return;
    const instance = viewer.current?.getInstance();
    if (!instance) return;
    if (line && line > 0) {
      instance.setSelectedLines({ id: file.identity, range: { start: line, end: line } });
      instance.scrollTo({
        type: "line",
        id: file.identity,
        lineNumber: line,
        align: "center",
        behavior: "instant",
      });
    } else if (initialScrollTop !== undefined) {
      instance.scrollTo({ type: "position", position: initialScrollTop, behavior: "instant" });
    } else return;
    // scrollTo queues Pierre's virtualizer. Flush it before the browser paints,
    // so a new preview never shows line 1 on its way to the requested location.
    instance.render(true);
    // initialScrollTop is a mount/source restore value, not a controlled scroll
    // position. Feeding onScrollPosition back must not move the user's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.identity, loading, line, column]);
  return (
    <section
      {...stylex.props(styles.root)}
      aria-label="Full file"
      aria-busy={loading}
      data-full-file-kind={file?.kind}
      data-file-plain={plain}
    >
      {!compact && (
        <header {...stylex.props(styles.header)}>
          <Icon name="file" size={15} />
          <span {...stylex.props(styles.path)} title={displayPath}>
            {displayPath}
          </span>
          <span {...stylex.props(styles.badge)} title={sourceLabel}>
            {sourceLabel.replace(/^Working files\b/, "Working file")}
          </span>
          <span {...stylex.props(styles.badge)}>Read-only</span>
          {loadBlame && (
            <button
              {...stylex.props(ui.button)}
              aria-label="Toggle Git blame"
              aria-pressed={blameOpen}
              disabled={file?.kind !== "text" || loading}
              title="Git blame (⌥B)"
              onClick={() => setBlameOpen(!blameOpen)}
            >
              <Icon name="history" size={14} />
              Blame
            </button>
          )}
          {onOpenBefore && (
            <button {...stylex.props(ui.button)} onClick={onOpenBefore}>
              Open before
            </button>
          )}
          {onOpenAfter && (
            <button {...stylex.props(ui.button)} onClick={onOpenAfter}>
              Open after
            </button>
          )}
          <button
            {...stylex.props(ui.button, ui.iconButton)}
            aria-label="Refresh file"
            title="Refresh file"
            disabled={loading}
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </button>
          {onClose && (
            <button
              {...stylex.props(ui.button, ui.iconButton)}
              aria-label="Close file"
              title="Close file"
              onClick={onClose}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </header>
      )}
      {stale && !loading && (
        <div role="status" {...stylex.props(styles.banner)}>
          <span>Workspace changed. Refresh this file to read the latest contents.</span>
          <button {...stylex.props(ui.button)} onClick={onRefresh}>
            Refresh contents
          </button>
        </div>
      )}
      {error ? (
        <div role="alert" {...stylex.props(styles.notice)}>
          {error}
        </div>
      ) : loading ? (
        <div {...stylex.props(styles.pending)} aria-hidden="true" />
      ) : file ? (
        <>
          {(plain || file.truncated) && file.kind === "text" && (
            <div role="status" {...stylex.props(styles.banner)}>
              {file.truncated ? "Partial preview" : "Plain text preview"} ·{" "}
              {file.reason ?? "Syntax highlighting is disabled for this file."}
            </div>
          )}
          {items.length ? (
            <div
              ref={vim.pane}
              data-file-pane={compact ? "preview" : "main"}
              {...stylex.props(styles.viewport)}
              tabIndex={vimEnabled ? 0 : -1}
              role="textbox"
              aria-readonly="true"
              aria-multiline="true"
              aria-label={vimEnabled ? "File navigation" : "File content"}
              onKeyDown={vim.keyDown}
              onFocus={vim.onFocus}
              onBlur={vim.onBlur}
              onClick={vim.onClick}
            >
              <CodeView
                key={file.identity}
                ref={viewer}
                items={items}
                options={options}
                onScroll={onScrollPosition}
                onSelectedLinesChange={setSelection}
                className={stylex.props(styles.code).className}
                style={
                  {
                    "--diffs-font-family": tokens.code,
                    "--diffs-font-size": "12px",
                    "--diffs-line-height": "20px",
                    "--diffs-bg-context-override": tokens.canvas,
                    "--diffs-bg-context-gutter-override": tokens.canvas,
                  } as CSSProperties
                }
              />
              <span
                ref={vim.caret}
                data-vim-caret=""
                hidden
                aria-hidden="true"
                {...stylex.props(styles.caret)}
              />
            </div>
          ) : (
            <div {...stylex.props(styles.notice)}>
              <p>
                {file.kind === "missing" && file.source.kind === "worktree"
                  ? "This file does not exist in this worktree."
                  : file.kind === "text"
                    ? "Text content is unavailable."
                    : notices[file.kind]}
              </p>
              <p {...stylex.props(styles.detail)}>
                {file.reason ?? `${file.size.toLocaleString()} bytes`}
              </p>
            </div>
          )}
        </>
      ) : (
        <div {...stylex.props(styles.notice)}>Choose a file to preview.</div>
      )}
      {vim.search && (
        <form
          {...stylex.props(styles.search)}
          onSubmit={(event) => {
            event.preventDefault();
            vim.submitSearch();
          }}
        >
          <span>{vim.search.direction === 1 ? "/" : "?"}</span>
          <input
            ref={(element) => element?.focus()}
            aria-label="Search in file"
            placeholder="Search text (literal, smart case)"
            value={vim.search.query}
            {...stylex.props(styles.searchInput)}
            onChange={(event) => vim.updateSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                vim.cancelSearch();
              }
            }}
          />
          <kbd>Enter</kbd>
          <span>accept</span>
          <kbd>Esc</kbd>
          <span>cancel</span>
        </form>
      )}
      {(vimEnabled || vim.message) && !compact && (
        <div {...stylex.props(styles.vimStatus)}>
          {vimEnabled ? "NORMAL · " : ""}
          {vim.message || "Read-only navigation"}
        </div>
      )}
      {blameOpen && file?.kind === "text" && (
        <aside aria-label="Git blame" {...stylex.props(styles.blame)}>
          <div {...stylex.props(styles.blameHeading)}>
            <Icon name="history" size={14} />
            <strong>Line history</strong>
            <span {...stylex.props(styles.detail)}>
              {startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`}
            </span>
            <span {...stylex.props(styles.blameHint)}>Select line numbers to inspect.</span>
            <button
              {...stylex.props(ui.button, ui.iconButton)}
              aria-label="Close Git blame"
              onClick={() => setBlameOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {stale ? (
            <p role="status">Refresh the file before reading its line history.</p>
          ) : currentBlame?.error ? (
            <p role="alert">{currentBlame.error}</p>
          ) : !currentBlame?.result ? (
            <p role="status">Loading line history…</p>
          ) : (
            <>
              {currentBlame.result.reason && <p role="status">{currentBlame.result.reason}</p>}
              {currentBlame.result.lines.map((entry) => (
                <div key={entry.line} {...stylex.props(styles.blameRow)}>
                  <span {...stylex.props(styles.lineNumber)}>L{entry.line}</span>
                  <code {...stylex.props(styles.commit)} title={entry.commit}>
                    {/^[0]+$/.test(entry.commit) ? "Uncommitted" : entry.commit.slice(0, 8)}
                  </code>
                  <span {...stylex.props(styles.author)} title={entry.author}>
                    {entry.author}
                  </span>
                  <span {...stylex.props(styles.summary)} title={entry.summary}>
                    {entry.summary}
                  </span>
                  <time {...stylex.props(styles.detail)} dateTime={entry.date}>
                    {entry.date.slice(0, 10)}
                  </time>
                </div>
              ))}
              {(selectedEndLine > endLine || currentBlame.result.truncated) && (
                <p role="status">Showing at most 200 selected lines.</p>
              )}
            </>
          )}
        </aside>
      )}
    </section>
  );
}
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    height: "100%",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    flexShrink: 0,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  path: {
    flex: "1",
    minWidth: 30,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    color: tokens.muted,
    fontSize: 11,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "35%",
  },
  viewport: {
    position: "relative",
    display: "flex",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    outline: "none",
  },
  pending: { flex: "1", minHeight: 0 },
  caret: {
    position: "absolute",
    pointerEvents: "none",
    backgroundColor: tokens.accent,
    opacity: 0.45,
    zIndex: 5,
    transitionProperty: { default: "none", ':is([data-animate="true"])': "left, top" },
    transitionDuration: { default: "65ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionTimingFunction: "ease-out",
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  searchInput: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.code,
  },
  vimStatus: {
    paddingBlock: 3,
    paddingInline: 12,
    color: tokens.muted,
    fontSize: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  code: {
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    scrollbarWidth: "thin",
    overscrollBehavior: "contain",
  },
  blame: {
    flexShrink: 0,
    maxHeight: 180,
    overflow: "auto",
    paddingInline: 12,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    backgroundColor: tokens.panel,
    fontSize: 11,
  },
  blameHeading: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  blameHint: { flex: "1", color: tokens.faint, textAlign: "right" },
  blameRow: { display: "flex", alignItems: "baseline", gap: 12, paddingBlock: 4 },
  lineNumber: { color: tokens.faint, fontFamily: tokens.code, minWidth: 40 },
  commit: { color: tokens.accent, fontFamily: tokens.code, minWidth: 75 },
  author: { maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  summary: {
    flex: "1",
    minWidth: 30,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  notice: { padding: 28, color: tokens.muted, lineHeight: 1.7 },
  detail: { color: tokens.faint, overflowWrap: "anywhere" },
  banner: {
    paddingBlock: 7,
    paddingInline: 12,
    backgroundColor: tokens.panel,
    color: tokens.muted,
    fontSize: 11,
  },
});

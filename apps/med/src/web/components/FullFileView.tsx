import * as stylex from "@stylexjs/stylex";
import {
  CodeView,
  useWorkerPool,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { BrowseRead } from "../../shared/browse";
import type { BlameLoader } from "../data/blame";
import { tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import "../pierre-theme";
import { Icon } from "./Icon";
import { useFileVim, type FileNavigationCommand } from "../data/use-file-vim";
import { pierreFile } from "../data/file-prefetch";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { supportedLanguage } from "../highlighting/languages";
import { createSearchHighlights } from "../data/search-highlights";
import { BlameTooltips } from "./BlameTooltips";
import { createBlameGutter } from "../data/blame-gutter";

export interface FileSymbolPreview {
  readonly origin?: { line: number; column: number };
  preview(line: number, column: number | undefined, name: string, selectLine?: boolean): void;
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
  onDefinition?(name: string): void;
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
  onDefinition,
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
    onDefinition,
  });
  const [symbolHighlight, setSymbolHighlight] = useState<string | null>(null);
  const beginSymbolPreview = useCallback<BeginFileSymbolPreview>(() => {
    const instance = viewer.current?.getInstance();
    const origin = vim.position.capture();
    const scrollTop = instance?.getScrollTop() ?? 0;
    const selected = instance?.getSelectedLines() ?? null;
    return {
      origin: { line: origin.line + 1, column: origin.column + 1 },
      preview(target, targetColumn, name, selectLine = true) {
        vim.position.jump(target, targetColumn);
        instance?.setSelectedLines(
          selectLine
            ? {
                id: file?.identity ?? "",
                range: { start: target, end: target },
              }
            : null,
        );
        instance?.render(true);
        setSymbolHighlight(name);
      },
      finish(accept) {
        setSymbolHighlight(null);
        if (accept) vim.position.accept(origin);
        else {
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
  const [blameNotice, setBlameNotice] = useState<{
    file: BrowseRead | null;
    message: string;
  } | null>(null);
  const canBlame = !!loadBlame && file?.kind === "text" && !stale && !loading && !error;
  const gutter = useMemo(
    () =>
      createBlameGutter(file, loadBlame, !compact && canBlame, (message) =>
        setBlameNotice({ file, message }),
      ),
    [file, loadBlame, compact, canBlame],
  );
  useLayoutEffect(() => () => gutter.dispose(), [gutter]);
  useLayoutEffect(() => gutter.setVisible(blameOpen), [gutter, blameOpen]);
  const blameCells = useSyncExternalStore(gutter.subscribe, gutter.getSnapshot);
  const setBlameOpen = (open: boolean) => {
    setLocalBlameEnabled(open);
    onBlameEnabledChange?.(open);
  };
  const plain = !!file?.plain;
  const language = getFiletypeFromFileName(file?.path ?? "");
  const unsupportedSyntax =
    import.meta.env.MED_HIGHLIGHTER !== "shiki" &&
    language !== "text" &&
    !supportedLanguage(language);
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (file?.kind !== "text" || typeof file.text !== "string") return [];
    return [
      {
        id: file.identity,
        type: "file",
        file: pierreFile(file),
      },
    ];
  }, [file]);
  const workerPool = useWorkerPool();
  useLayoutEffect(() => {
    if (loading || file?.kind !== "text" || file.plain || !workerPool?.isWorkingPool()) return;
    const input = pierreFile(file);
    if (workerPool.getFileResultCache(input)) return;
    let cancelled = false;
    // The pool deduplicates this with the early read and CodeView requests.
    // Commit the visible file as soon as its result is ready instead of waiting
    // for an additional virtualizer frame. Other files still use normal batching.
    void workerPool
      .primeFileHighlightCache(input)
      .then(() => {
        if (!cancelled) viewer.current?.getInstance()?.render(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file, loading, workerPool]);
  const visualName = vim.visualName;
  const activeSearchName = vim.activeSearchName;
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      overflow: "scroll",
      disableFileHeader: true,
      enableLineSelection: true,
      // Keep hover and gutter dragging active immediately after keyboard scrolling.
      pointerEventsOnScroll: true,
      tokenizeMaxLineLength: 1000,
      unsafeCSS: `[data-line] { tab-size: 2; }
        ::highlight(${highlightId}) { background-color: ${active.palette.warning}; color: ${active.palette.canvas}; }
        ::highlight(${activeSearchName}) { background-color: ${active.palette.accent}; color: ${active.palette.canvas}; text-decoration: underline; }
        ::highlight(${visualName}) { background-color: color-mix(in srgb, ${active.palette.accent} 45%, transparent); color: ${active.palette.text}; }
        [data-vim-visual-line] { background: color-mix(in srgb, ${active.palette.accent} 45%, transparent) !important; }
        [data-vim-visual-empty] { position: relative; }
        ${
          blameOpen && canBlame
            ? `[data-column-number] { padding-left: 196px; }
        [data-med-blame] { position: absolute; left: 8px; top: 0; width: 176px; height: 100%; display: flex; align-items: baseline; gap: 8px; font-family: var(--diffs-header-font-family); font-size: 10px; text-align: left; color: ${active.palette.muted}; user-select: none; overflow: hidden; white-space: nowrap; }
        [data-med-blame-trigger] { display: flex; align-items: baseline; gap: 6px; width: 100%; height: 100%; }
        [data-med-blame-trigger] > :first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        [data-med-blame-trigger] > :not(:first-child) { flex-shrink: 0; color: ${active.palette.faint}; }`
            : ""
        }
        [data-vim-visual-empty]::before { content: ""; position: absolute; width: 1ch; height: 100%; background: color-mix(in srgb, ${active.palette.accent} 45%, transparent); pointer-events: none; }`,
      onPostRender(node, _instance, phase) {
        gutter.update(node, phase);
        vimRender.current(node, phase);
        if (phase === "unmount") highlights.dispose();
        else
          highlights.update(node, currentHighlightQuery.current, currentHighlightOptions.current);
      },
      layout: { gap: 0, paddingTop: 8, paddingBottom: 16 },
    }),
    [active, highlightId, highlights, visualName, activeSearchName, gutter, blameOpen, canBlame],
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
      {blameOpen && (stale || (blameNotice?.file === file && blameNotice.message)) && (
        <div role="status" {...stylex.props(styles.banner)}>
          {stale ? "Refresh the file before reading its line history." : blameNotice?.message}
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
          {(plain || file.truncated || unsupportedSyntax) && file.kind === "text" && (
            <div role="status" {...stylex.props(styles.banner)}>
              {file.truncated ? "Partial preview" : "Plain text preview"} ·{" "}
              {file.reason ??
                (unsupportedSyntax
                  ? `Syntax highlighting is not available for ${language}.`
                  : "Syntax highlighting is disabled for this file.")}
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
              onCopy={vim.onCopy}
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
      {vim.commandLine && (
        <form
          {...stylex.props(styles.search)}
          onSubmit={(event) => {
            event.preventDefault();
            vim.submitCommandLine();
          }}
        >
          <span>:</span>
          <input
            ref={(element) => element?.focus()}
            aria-label="Go to line"
            aria-invalid={!!vim.commandLine.error}
            placeholder="Line number"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            value={vim.commandLine.value}
            {...stylex.props(styles.searchInput)}
            onChange={(event) => vim.updateCommandLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                vim.cancelCommandLine();
              }
            }}
          />
          {vim.commandLine.error && <span role="alert">{vim.commandLine.error}</span>}
          <kbd>Enter</kbd>
          <span>go</span>
          <kbd>Esc</kbd>
          <span>cancel</span>
        </form>
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
          {vimEnabled
            ? vim.commandLine
              ? "COMMAND · "
              : vim.visualMode === "line"
                ? "VISUAL LINE · "
                : vim.visualMode
                  ? "VISUAL · "
                  : "NORMAL · "
            : ""}
          <span role={vim.copyError ? "alert" : undefined}>
            {vim.copyMessage ||
              (vim.visualMode
                ? "y to copy · Esc to cancel"
                : vim.message || "Read-only navigation")}
          </span>
        </div>
      )}
      <BlameTooltips cells={blameCells} />
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
    minHeight: 32,
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

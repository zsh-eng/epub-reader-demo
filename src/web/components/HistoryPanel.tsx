import * as stylex from "@stylexjs/stylex";
import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import type { Commit } from "../../shared/protocol";
import { layoutHistory, type GraphRow } from "./history-layout";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

const rowHeight = 48;
const colors = ["#8cabdf", "#b5a0d6", "#82b6ad", "#d0ad7e", "#ce97ad", "#a2b97b"];
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function Graph({ row }: { row: GraphRow }) {
  const x = (lane: number) => 10 + lane * 12;
  return (
    <svg
      width={Math.max(28, row.width * 12 + 9)}
      height={rowHeight}
      aria-hidden="true"
      {...stylex.props(styles.graph)}
    >
      {row.edges.map((edge, index) => (
        <path
          key={index}
          d={
            edge.incoming
              ? `M${x(edge.from)} 0 L${x(edge.from)} 20 C${x(edge.from)} 36 ${x(edge.to)} 32 ${x(edge.to)} 48`
              : `M${x(edge.from)} 20 C${x(edge.from)} 36 ${x(edge.to)} 32 ${x(edge.to)} 48`
          }
          stroke={colors[edge.color % colors.length]}
          fill="none"
          strokeWidth="1.25"
          opacity=".7"
        />
      ))}
      {row.incoming && (
        <path
          d={`M${x(row.lane)} 0V20`}
          stroke={colors[row.lane % colors.length]}
          strokeWidth="1.25"
        />
      )}
      <circle cx={x(row.lane)} cy="20" r="3.5" fill={colors[row.lane % colors.length]} />
      {row.commit.parents.length > 1 && <circle cx={x(row.lane)} cy="20" r="1.5" fill="#20242b" />}
    </svg>
  );
}

export function HistoryPanel({
  commits,
  selected,
  selectedRange,
  loading,
  hasMore,
  error,
  onSelect,
  onSelectRange,
  onLoadMore,
  onWorking,
  working,
  workingAvailable = true,
}: {
  commits: Commit[];
  selected?: string;
  selectedRange?: { base: string; head: string };
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  onSelect(commit: string): void;
  onSelectRange?(oldest: string, newest: string): void;
  onLoadMore(): void;
  onWorking(): void;
  working: boolean;
  workingAvailable?: boolean;
}) {
  const pendingSelection = useRef(selected);
  const anchor = useRef(selected);
  const rangeStart = commits.findIndex((commit) => commit.id === selectedRange?.head);
  const rangeEnd = commits.findIndex((commit) => commit.id === selectedRange?.base);
  const isSelected = (id: string, index: number) =>
    selectedRange ? rangeStart >= 0 && index >= rangeStart && index <= rangeEnd : selected === id;
  useLayoutEffect(() => {
    if (!selectedRange) {
      pendingSelection.current = selected;
      anchor.current = selected;
    }
  }, [selected, selectedRange]);
  const selectCommit = (id: string, extend = false) => {
    pendingSelection.current = id;
    const from = commits.findIndex((commit) => commit.id === anchor.current);
    const to = commits.findIndex((commit) => commit.id === id);
    if (extend && onSelectRange && from >= 0 && to >= 0) {
      onSelectRange(commits[Math.max(from, to)]!.id, commits[Math.min(from, to)]!.id);
      return;
    }
    anchor.current = id;
    onSelect(id);
  };
  const rows = useMemo(() => layoutHistory(commits), [commits]);
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 320 });
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setViewport((value) => ({ ...value, height: node.clientHeight })),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 6);
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 6);
  const selectRelative = (delta: number, extend: boolean) => {
    const index = commits.findIndex((commit) => commit.id === pendingSelection.current);
    const nextIndex = Math.max(0, Math.min(commits.length - 1, index + delta));
    const next = commits[nextIndex];
    if (next) {
      selectCommit(next.id, extend);
      container.current?.scrollTo({
        top: Math.max(0, nextIndex * rowHeight - viewport.height / 2),
      });
    }
  };
  return (
    <section {...stylex.props(styles.panel)} aria-label="Commit history">
      <div {...stylex.props(styles.heading)}>
        <span {...stylex.props(ui.row)}>
          <Icon name="history" size={14} />
          History
        </span>
        <span {...stylex.props(ui.faint, ui.mono)}>
          {commits.length}
          {hasMore ? "+" : ""}
        </span>
      </div>
      {workingAvailable && (
        <button
          {...stylex.props(styles.working, working && styles.selected)}
          onClick={() => {
            pendingSelection.current = undefined;
            anchor.current = undefined;
            onWorking();
          }}
          aria-pressed={working}
        >
          <span {...stylex.props(styles.workingDot)} />
          <span>Working changes</span>
          <span {...stylex.props(ui.grow)} />
          <Icon name="branch" size={12} />
        </button>
      )}
      <div
        ref={container}
        {...stylex.props(styles.scroll)}
        tabIndex={0}
        role="listbox"
        aria-label="Commits"
        aria-multiselectable={!!onSelectRange}
        aria-activedescendant={
          rows.slice(start, end).some((row) => row.commit.id === selected)
            ? `commit-${selected}`
            : undefined
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            selectRelative(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
          }
        }}
        onScroll={(event) => {
          const node = event.currentTarget;
          setViewport({ top: node.scrollTop, height: node.clientHeight });
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 180 && hasMore && !loading)
            onLoadMore();
        }}
      >
        <div style={{ height: rows.length * rowHeight, position: "relative" }}>
          {rows.slice(start, end).map((row, offset) => (
            <button
              id={`commit-${row.commit.id}`}
              key={row.commit.id}
              role="option"
              aria-selected={isSelected(row.commit.id, start + offset)}
              tabIndex={-1}
              title={`${row.commit.subject}\n${row.commit.id}\n${row.commit.author}`}
              onClick={(event) => selectCommit(row.commit.id, event.shiftKey)}
              className={
                stylex.props(
                  styles.commit,
                  isSelected(row.commit.id, start + offset) && styles.selected,
                ).className
              }
              style={{ top: (start + offset) * rowHeight }}
            >
              <Graph row={row} />
              <span {...stylex.props(styles.commitText)}>
                <span {...stylex.props(styles.subject)}>
                  {row.commit.subject || "(no commit message)"}
                </span>
                <span {...stylex.props(styles.metadata)}>
                  {row.commit.refs.length > 0 && (
                    <span {...stylex.props(styles.refs)}>{row.commit.refs.join(" · ")}</span>
                  )}
                  <span {...stylex.props(ui.truncate)}>{row.commit.author}</span>
                  <span>{dateFormatter.format(new Date(row.commit.timestamp * 1000))}</span>
                </span>
              </span>
              <span {...stylex.props(styles.commitHash)}>{row.commit.id.slice(0, 7)}</span>
            </button>
          ))}
        </div>
        {commits.length === 0 && !loading && !error && (
          <div {...stylex.props(styles.empty)}>No commits yet</div>
        )}
        {error && (
          <div role="alert" {...stylex.props(styles.empty)}>
            {error}
          </div>
        )}
        {(hasMore || loading) && (
          <button
            {...stylex.props(ui.button, styles.loadMore)}
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? "Loading history…" : "Load earlier commits"}
          </button>
        )}
      </div>
    </section>
  );
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    minHeight: 140,
    height: "43%",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 14,
    height: 38,
    minHeight: 38,
    fontSize: 11,
    fontWeight: 600,
    color: tokens.muted,
  },
  working: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginInline: 6,
    marginBottom: 5,
    minHeight: 30,
    paddingInline: 9,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    borderWidth: 0,
    borderRadius: 4,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accent}` },
  },
  workingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.green,
  },
  scroll: {
    flex: "1",
    overflowY: "auto",
    overflowX: "hidden",
    minHeight: 0,
    scrollbarWidth: "thin",
    outline: { default: "none", ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: -1,
  },
  commit: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: rowHeight,
    padding: 0,
    paddingRight: 10,
    boxSizing: "border-box",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
  },
  selected: { backgroundColor: { default: tokens.selected, ":hover": tokens.selected } },
  graph: { flexShrink: 0, maxWidth: 94, overflow: "hidden", marginLeft: 6 },
  commitText: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 },
  subject: { fontSize: 12, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  refs: {
    color: tokens.accent,
    maxWidth: 80,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 9,
  },
  metadata: { display: "flex", alignItems: "center", gap: 8, color: tokens.faint, fontSize: 10 },
  commitHash: {
    alignSelf: "flex-start",
    marginTop: 12,
    marginLeft: 6,
    fontFamily: tokens.code,
    color: tokens.faint,
    fontSize: 9,
  },
  loadMore: { width: "100%", paddingBlock: 10 },
  empty: { padding: 16, fontSize: 12, color: tokens.muted },
});

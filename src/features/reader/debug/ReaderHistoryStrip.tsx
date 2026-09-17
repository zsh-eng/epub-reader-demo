import {
  BookOpen,
  Highlighter,
  Laptop,
  MonitorSmartphone,
  Smartphone,
  Tablet,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import type { DeviceType } from "@/types/session";
import { FooterPageIndicator } from "../footer/FooterPageIndicator";
import type { ReaderVisitKind } from "../jump-history";
import "./reader-history-strip.css";

const VISIT_ICONS: Partial<Record<ReaderVisitKind, LucideIcon>> = {
  normal: BookOpen,
  highlight: Highlighter,
  handoff: MonitorSmartphone,
};
const DEVICE_ICONS: Record<DeviceType, LucideIcon> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Laptop,
};
// Compact, stable cells prevent grouped replacements from shifting the strip.
const ENTRY_PITCH_REM = 4.5;
const VISIT_LABELS: Record<ReaderVisitKind, string> = {
  normal: "Reading",
  highlight: "Highlight",
  "internal-link": "Internal link",
  toc: "Contents",
  search: "Search result",
  note: "Note",
  scrubber: "Scrub",
  chapter: "Chapter",
  handoff: "Device handoff",
};

export interface HistoryStripEntry {
  slot: number;
  page: number;
  kind: ReaderVisitKind;
  deviceType?: DeviceType;
}
interface ReaderHistoryStripProps {
  entries: HistoryStripEntry[];
  cursor: number;
  page: number;
  total: number;
  expanded: boolean;
  animate: boolean;
  onSelect: (index: number, animate: boolean) => void;
  onExpandedChange: (expanded: boolean, animate: boolean) => void;
}

/** The current visit stays centred while the trail translates beneath it.
 * Slots belong to array positions, so grouped replacements do not move the track.
 * Quiet mode uses the original footer indicator, including its typography.
 */
export function ReaderHistoryStrip({
  entries,
  cursor,
  page,
  total,
  expanded,
  animate,
  onSelect,
  onExpandedChange,
}: ReaderHistoryStripProps) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    rootRef.current
      ?.querySelector<HTMLButtonElement>(
        expanded ? '[aria-current="location"]' : ".history-strip-quiet",
      )
      ?.focus({ preventScroll: true });
  }, [cursor, expanded]);
  const activeSlot = entries[cursor].slot;
  const duration = reduceMotion || !animate || !expanded ? 0 : 0.18;
  return (
    <div
      ref={rootRef}
      className="reader-history-strip font-numeric text-[10px] font-medium uppercase tracking-[0.06em] tabular-nums"
      data-testid="history-strip"
      data-mode={expanded ? "history" : "quiet"}
      data-current-page={page}
      onKeyDown={(event) => {
        if (!expanded) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          moveFocus.current = true;
          onExpandedChange(false, false);
          return;
        }
        const direction =
          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (!direction) return;
        event.preventDefault();
        const next = cursor + direction;
        event.stopPropagation();
        if (entries[next]) {
          moveFocus.current = true;
          onSelect(next, false);
        }
      }}
    >
      <div
        className="history-strip-focus"
        data-testid="history-strip-focus"
        aria-hidden="true"
      />
      <div
        className="history-strip-viewport"
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <motion.div
          className="history-strip-track"
          data-testid="history-strip-track"
          data-active-slot={activeSlot}
          initial={false}
          animate={{
            transform: `translateX(${-activeSlot * ENTRY_PITCH_REM}rem)`,
          }}
          transition={{ duration, ease: [0.77, 0, 0.175, 1] }}
        >
          {entries.map((entry, index) => {
            const Icon =
              entry.kind === "handoff" && entry.deviceType
                ? DEVICE_ICONS[entry.deviceType]
                : VISIT_ICONS[entry.kind];
            const current = index === cursor;
            const label = `${current ? "Current" : index < cursor ? "Earlier visit:" : "Later visit:"} page ${entry.page}, ${VISIT_LABELS[entry.kind]}${entry.kind === "handoff" && entry.deviceType ? `, ${entry.deviceType}` : ""}`;
            return (
              <button
                key={entry.slot}
                type="button"
                className="history-strip-entry"
                style={{
                  transform: `translateX(${entry.slot * ENTRY_PITCH_REM}rem)`,
                }}
                aria-current={current ? "location" : undefined}
                aria-label={label}
                title={label}
                tabIndex={Math.abs(index - cursor) <= 1 ? 0 : -1}
                data-slot={entry.slot}
                data-kind={entry.kind}
                onClick={(event) => {
                  moveFocus.current = true;
                  if (current) onExpandedChange(false, event.detail !== 0);
                  else onSelect(index, event.detail !== 0);
                }}
              >
                <span className="history-strip-value">
                  {Icon && (
                    <span className="history-strip-icon" aria-hidden="true">
                      <Icon size={12} strokeWidth={1.7} />
                      {entry.kind === "highlight" && (
                        <span className="history-strip-highlight-tip" />
                      )}
                    </span>
                  )}
                  <span className="history-strip-number">{entry.page}</span>
                </span>
              </button>
            );
          })}
        </motion.div>
      </div>
      <button
        type="button"
        className="history-strip-quiet"
        aria-label={`Page ${page} of ${total}. Show jump history`}
        aria-expanded={expanded}
        tabIndex={expanded ? -1 : 0}
        inert={expanded}
        aria-hidden={expanded}
        onClick={(event) => {
          moveFocus.current = true;
          onExpandedChange(true, event.detail !== 0);
        }}
      >
        <FooterPageIndicator currentPage={page} totalPages={total} />
      </button>
      <span className="sr-only" role="status">
        Page {page} of {total}
      </span>
    </div>
  );
}

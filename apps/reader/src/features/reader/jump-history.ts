import type { ContentAnchor, SpreadIntent } from "@/lib/pagination-v2";

export const READER_HISTORY_LIMIT = 30;
export type ReaderVisitKind =
  | "normal"
  | Extract<SpreadIntent, { kind: "jump" }>["source"];
export interface ReaderVisit {
  kind: ReaderVisitKind;
  anchor: ContentAnchor;
}
export interface ReaderJumpHistory {
  entries: ReaderVisit[];
  cursor: number;
}
export const EMPTY_READER_HISTORY: ReaderJumpHistory = {
  entries: [],
  cursor: -1,
};

export function sameReaderAnchor(a: ContentAnchor, b: ContentAnchor): boolean {
  if (
    a.type !== b.type ||
    a.chapterIndex !== b.chapterIndex ||
    a.blockId !== b.blockId
  )
    return false;
  return (
    a.type === "block" ||
    (b.type === "text" &&
      a.offset.itemIndex === b.offset.itemIndex &&
      a.offset.segmentIndex === b.offset.segmentIndex &&
      a.offset.graphemeIndex === b.offset.graphemeIndex)
  );
}

/** Owns the active trail. Only confirmed locations enter history; previews and
 * relayout events cannot consume entries or erase the Forward branch.
 * Movement kinds group consecutive destinations. Back/Forward end grouping.
 */
export class ReaderJumpHistoryController {
  private state: ReaderJumpHistory;
  private mergeKind: ReaderVisitKind | null;

  constructor(initial: ReaderJumpHistory = EMPTY_READER_HISTORY) {
    this.state = initial;
    this.mergeKind =
      initial.entries[initial.cursor]?.kind === "normal" ? "normal" : null;
  }

  getSnapshot = (): ReaderJumpHistory => this.state;

  endGroup = (): void => {
    this.mergeKind = null;
  };

  getReturnTarget(direction: "back" | "forward") {
    const targetIndex = this.state.cursor + (direction === "back" ? -1 : 1);
    const entry = this.state.entries[targetIndex];
    if (!entry) return null;
    return {
      anchor: entry.anchor,
      intent: { kind: "history", targetIndex } as const,
    };
  }

  record = (anchor: ContentAnchor, intent: SpreadIntent): ReaderJumpHistory => {
    if (intent.kind === "preview") return this.state;

    if (intent.kind === "history") {
      const target = this.state.entries[intent.targetIndex];
      if (!target || !sameReaderAnchor(target.anchor, anchor))
        return this.state;
      this.endGroup();
      if (this.state.cursor !== intent.targetIndex) {
        this.state = { ...this.state, cursor: intent.targetIndex };
      }
      return this.state;
    }

    const current = this.state.entries[this.state.cursor];
    if (!current) {
      const kind = intent.kind === "jump" ? intent.source : "normal";
      this.state = { entries: [{ kind, anchor }], cursor: 0 };
      this.mergeKind = kind;
      return this.state;
    }
    if (intent.kind === "replace" || intent.kind === "restore")
      return this.state;

    const kind = intent.kind === "linear" ? "normal" : intent.source;
    if (sameReaderAnchor(current.anchor, anchor)) {
      if (kind !== current.kind) this.endGroup();
      return this.state;
    }

    const entries = this.state.entries.slice(0, this.state.cursor + 1);
    const canMerge =
      this.state.cursor === this.state.entries.length - 1 &&
      (kind === "normal" || this.mergeKind === kind) &&
      current.kind === kind &&
      kind !== "internal-link" &&
      kind !== "handoff";
    if (canMerge) entries[entries.length - 1] = { kind, anchor };
    else entries.push({ kind, anchor });

    const bounded = entries.slice(-READER_HISTORY_LIMIT);
    this.state = { entries: bounded, cursor: bounded.length - 1 };
    this.mergeKind = kind;
    return this.state;
  };
}

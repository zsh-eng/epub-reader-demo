import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { SpreadIntent } from "@/lib/pagination-v2";
import {
  loadReaderJumpHistory,
  saveReaderJumpHistory,
} from "../data/jump-history-storage";
import {
  EMPTY_READER_HISTORY,
  READER_HISTORY_LIMIT,
  ReaderJumpHistoryController,
  type ReaderJumpHistory,
  type ReaderVisitKind,
} from "../jump-history";

export const PLAYGROUND_STORAGE_KEY = "reader-jump-history-playground-v1";
// Exercise the Reader serializer in a separate value. No real book is changed.
const storage = {
  getItem: () => getRuntimeStorage().getItem(PLAYGROUND_STORAGE_KEY),
  setItem: (_key: string, value: string) =>
    getRuntimeStorage().setItem(PLAYGROUND_STORAGE_KEY, value),
};
export const ACTION_TYPES = [
  ["normal", "Normal navigation"],
  ["highlight", "Highlight jump"],
  ["scrubber", "Scrub commit"],
  ["preview", "Scrub preview"],
  ["internal-link", "Internal link"],
  ["toc", "Contents jump"],
  ["search", "Search result"],
  ["note", "Note jump"],
  ["chapter", "Chapter jump"],
  ["handoff", "Device handoff"],
] as const;
export type ActionType = ReaderVisitKind | "preview";
export type PlaygroundAction =
  | { type: "visit"; kind: ActionType; destination: string }
  | { type: "history"; targetIndex: number }
  | {
      type:
        | "back"
        | "forward"
        | "end-group"
        | "relayout"
        | "show-history"
        | "hide-history";
    };

const visit = (kind: ActionType, destination: string): PlaygroundAction => ({
  type: "visit",
  kind,
  destination,
});
export const EXAMPLES: {
  name: string;
  description: string;
  actions: PlaygroundAction[];
}[] = [
  {
    name: "Highlights, then reading",
    description: "Keep H3, add a normal reading entry, then jump to H4.",
    actions: [
      visit("highlight", "H1"),
      visit("highlight", "H2"),
      visit("highlight", "H3"),
      visit("normal", "R1"),
      visit("normal", "R2"),
      visit("highlight", "H4"),
    ],
  },
  {
    name: "Scrub, then highlight",
    description: "Previews leave A intact. Commit B3 before jumping to C.",
    actions: [
      visit("preview", "B1"),
      visit("preview", "B2"),
      visit("preview", "B3"),
      visit("scrubber", "B3"),
      visit("highlight", "C"),
      { type: "back" },
    ],
  },
  {
    name: "New branch after Back",
    description: "Return from C to B, then replace the Forward branch with D.",
    actions: [
      visit("highlight", "B"),
      visit("internal-link", "C"),
      { type: "back" },
      visit("toc", "D"),
    ],
  },
  {
    name: "Nested internal links",
    description:
      "Keep every link source. Back and Forward only move the cursor.",
    actions: [
      visit("internal-link", "B"),
      visit("internal-link", "C"),
      { type: "back" },
      { type: "back" },
      { type: "forward" },
      { type: "forward" },
    ],
  },
  {
    name: "Close and reopen a picker",
    description: "Ending the group keeps H1 when you next jump to H2.",
    actions: [
      visit("highlight", "H1"),
      { type: "end-group" },
      visit("highlight", "H2"),
    ],
  },
  {
    name: "Reach the history limit",
    description: `Add ${READER_HISTORY_LIMIT + 2} links to see the oldest entries leave the array.`,
    actions: Array.from({ length: READER_HISTORY_LIMIT + 2 }, (_, i) =>
      visit("internal-link", `L${i + 1}`),
    ),
  },
  {
    name: "Pages 81 → 140 → 25",
    description:
      "Follow the trail, not page order. Finish at 140 with visits on both sides.",
    actions: [
      visit("highlight", "140"),
      visit("internal-link", "25"),
      { type: "back" },
    ],
  },
  {
    name: "Device handoffs",
    description:
      "Sample phone, desktop, and tablet sources. Unlabelled handoffs use a generic device icon.",
    actions: [
      visit("handoff", "Phone140"),
      visit("handoff", "Desktop25"),
      visit("handoff", "Tablet210"),
      { type: "back" },
    ],
  },
  {
    name: "Page number widths",
    description: "Keep the current visit centred through 9, 99, 100, and 1000.",
    actions: [
      visit("internal-link", "9"),
      visit("internal-link", "99"),
      visit("internal-link", "100"),
      visit("internal-link", "1000"),
    ],
  },
];

export function actionLabel(action: PlaygroundAction): string {
  if (action.type === "history")
    return `Select history entry ${action.targetIndex}`;
  if (action.type === "visit")
    return `${ACTION_TYPES.find(([kind]) => kind === action.kind)?.[1]} → ${action.destination}`;
  return {
    back: "Back",
    forward: "Forward",
    "end-group": "End exploration group",
    relayout: "Simulate relayout",
    "show-history": "Show history strip",
    "hide-history": "Quiet page count",
  }[action.type];
}

export interface PlaygroundSession {
  controller: ReaderJumpHistoryController;
  snapshot: ReaderJumpHistory;
  preview: string | null;
  log: { id: number; action: string; result: string }[];
  actionCount: number;
  historyVisible: boolean;
  // Preserve the strip's coordinates when the bounded array drops its first entry.
  firstSlot: number;
}

export function createPlayground(
  initial = EMPTY_READER_HISTORY,
): PlaygroundSession {
  const controller = new ReaderJumpHistoryController(initial);
  if (!initial.entries.length)
    controller.record(
      { type: "block", chapterIndex: 0, blockId: "A" },
      { kind: "restore" },
    );
  return {
    controller,
    snapshot: controller.getSnapshot(),
    preview: null,
    log: [],
    actionCount: 0,
    historyVisible: false,
    firstSlot: 0,
  };
}

export function loadPlayground(): PlaygroundSession {
  try {
    return createPlayground(loadReaderJumpHistory(storage, "playground", "v1"));
  } catch {
    return createPlayground();
  }
}

export function savePlayground(snapshot: ReaderJumpHistory): void {
  saveReaderJumpHistory(storage, "playground", "v1", snapshot);
}

/** Synthetic locations exercise the production controller directly. This route
 * makes no assumptions about pagination and does not simulate worker timing.
 */
export function runPlaygroundAction(
  session: PlaygroundSession,
  action: PlaygroundAction,
): PlaygroundSession {
  const { controller, snapshot: before } = session;
  let preview: string | null = null;
  let result = "Array unchanged.";
  let historyVisible = session.historyVisible;
  let firstSlot = session.firstSlot;
  if (action.type === "show-history" || action.type === "hide-history") {
    historyVisible = action.type === "show-history";
    result =
      "Only the footer presentation changed. Array and cursor unchanged.";
  } else if (action.type === "history") {
    const entry = before.entries[action.targetIndex];
    if (entry)
      controller.record(entry.anchor, {
        kind: "history",
        targetIndex: action.targetIndex,
      });
  } else if (action.type === "end-group") {
    controller.endGroup();
    result = "Group ended. The next jump starts a new entry.";
  } else if (action.type === "relayout") {
    controller.record(before.entries[before.cursor].anchor, {
      kind: "replace",
    });
    result = "Relayout is not a visit. Array and cursor unchanged.";
  } else if (action.type === "back" || action.type === "forward") {
    const target = controller.getReturnTarget(action.type);
    if (target) controller.record(target.anchor, target.intent);
    else result = `No ${action.type === "back" ? "earlier" : "later"} entry.`;
  } else if (action.type === "visit") {
    const { destination, kind } = action;
    const intent: SpreadIntent =
      kind === "normal"
        ? { kind: "linear", direction: "forward" }
        : kind === "preview"
          ? { kind: "preview", source: "scrubber" }
          : { kind: "jump", source: kind };
    controller.record(
      { type: "block", chapterIndex: 0, blockId: destination },
      intent,
    );
    if (kind === "preview") {
      preview = destination;
      result = `Previewing ${destination}. Array and cursor unchanged.`;
    }
  }
  const snapshot = controller.getSnapshot();
  if (action.type === "visit" && action.kind === "normal")
    historyVisible = false;
  else if (snapshot !== before) historyVisible = true;
  if (snapshot !== before) {
    if (snapshot.entries === before.entries)
      result = `Cursor ${before.cursor} → ${snapshot.cursor}. Array unchanged.`;
    else if (before.cursor < before.entries.length - 1)
      result = `Discarded ${before.entries.length - before.cursor - 1} Forward entries; appended entry ${snapshot.cursor}.`;
    else if (snapshot.entries.length > before.entries.length)
      result = `Appended entry ${snapshot.cursor}.`;
    else if (
      snapshot.entries[0] !== before.entries[0] &&
      snapshot.entries.length === READER_HISTORY_LIMIT
    ) {
      firstSlot += 1;
      result = `Removed the oldest entry; appended entry ${snapshot.cursor}.`;
    } else result = `Replaced entry ${snapshot.cursor}.`;
  }
  const actionCount = session.actionCount + 1;
  return {
    controller,
    snapshot,
    preview,
    actionCount,
    historyVisible,
    firstSlot,
    log: [
      { id: actionCount, action: actionLabel(action), result },
      ...session.log,
    ].slice(0, 12),
  };
}

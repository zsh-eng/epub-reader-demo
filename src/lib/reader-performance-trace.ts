import { getDebugEnabled, subscribeDebugPreference } from "./debug-preference";
import { useSyncExternalStore } from "react";

export const READER_TRACE_STORAGE_KEY = "reader-performance-traces-v1";
export const READER_TRACE_RECORDING_KEY =
  "reader-performance-tracing-enabled-v1";

const READER_TRACE_SCHEMA_VERSION = 1;
const MAX_STORED_TRACES = 30;
const MAX_SPANS_PER_TRACE = 160;

export const READER_TRACE_LANES = [
  "navigation",
  "storage",
  "processing",
  "pagination",
  "assets",
  "reveal",
] as const;

export type ReaderTraceLane = (typeof READER_TRACE_LANES)[number];
export type ReaderTraceDetailValue = string | number | boolean | null;
export type ReaderTraceDetails = Record<string, ReaderTraceDetailValue>;

export interface ReaderTraceSpan {
  id: string;
  name: string;
  lane: ReaderTraceLane;
  kind: "span" | "mark";
  startMs: number;
  endMs: number | null;
  status: "running" | "ok" | "error";
  details: ReaderTraceDetails;
}

export interface ReaderPerformanceTrace {
  version: typeof READER_TRACE_SCHEMA_VERSION;
  id: string;
  bookId: string;
  bookTitle: string | null;
  source: string;
  startedAt: number;
  durationMs: number | null;
  status: "recording" | "completed" | "error" | "interrupted";
  metadata: ReaderTraceDetails;
  spans: ReaderTraceSpan[];
}

export interface ReaderTraceSpanToken {
  traceId: string;
  spanId: string;
}

interface ReaderTraceSnapshot {
  recordingEnabled: boolean;
  traces: ReaderPerformanceTrace[];
  activeTraceId: string | null;
}

interface ActiveTraceRuntime {
  traceId: string;
  startedAtMs: number;
}

declare global {
  interface Window {
    __READER_TRACE_CONTEXT__?: {
      mainThreadCpuThrottleRate?: number;
      cpuThrottleScope?: "main-thread";
      runLabel?: string;
      workerCpuThrottleRate?: number;
    };
  }
}

const listeners = new Set<() => void>();
let activeRuntime: ActiveTraceRuntime | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readRecordingEnabled(): boolean {
  return getStorage()?.getItem(READER_TRACE_RECORDING_KEY) === "true";
}

function isStoredTrace(value: unknown): value is ReaderPerformanceTrace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReaderPerformanceTrace>;
  return (
    candidate.version === READER_TRACE_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.bookId === "string" &&
    Array.isArray(candidate.spans)
  );
}

function readStoredTraces(): ReaderPerformanceTrace[] {
  const serialized = getStorage()?.getItem(READER_TRACE_STORAGE_KEY);
  if (!serialized) return [];

  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];

    return value.filter(isStoredTrace).map((trace) =>
      trace.status === "recording"
        ? {
            ...trace,
            status: "interrupted" as const,
            durationMs:
              trace.durationMs ??
              Math.max(
                0,
                ...trace.spans.map((span) => span.endMs ?? span.startMs),
              ),
            spans: trace.spans.map((span) =>
              span.status === "running"
                ? {
                    ...span,
                    endMs: span.endMs ?? span.startMs,
                    status: "error" as const,
                    details: { ...span.details, interrupted: true },
                  }
                : span,
            ),
          }
        : trace,
    );
  } catch {
    return [];
  }
}

let snapshot: ReaderTraceSnapshot = {
  recordingEnabled: readRecordingEnabled(),
  traces: readStoredTraces(),
  activeTraceId: null,
};

function emitChange(): void {
  for (const listener of listeners) listener();
}

function persistTraces(traces: ReaderPerformanceTrace[]): void {
  const storage = getStorage();
  if (!storage) return;

  let retained = traces.slice(0, MAX_STORED_TRACES);
  while (retained.length > 0) {
    try {
      storage.setItem(READER_TRACE_STORAGE_KEY, JSON.stringify(retained));
      return;
    } catch {
      retained = retained.slice(0, -1);
    }
  }

  try {
    storage.removeItem(READER_TRACE_STORAGE_KEY);
  } catch {
    // Recording must never block the reader if storage is unavailable.
  }
}

function setSnapshot(next: ReaderTraceSnapshot): void {
  snapshot = next;
  if (persistTimer === null) {
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistTraces(snapshot.traces);
    }, 500);
  }
  emitChange();
}

function elapsedMs(): number {
  if (!activeRuntime) return 0;
  return Math.max(0, performance.now() - activeRuntime.startedAtMs);
}

function updateTrace(
  traceId: string,
  update: (trace: ReaderPerformanceTrace) => ReaderPerformanceTrace,
): void {
  let changed = false;
  const traces = snapshot.traces.map((trace) => {
    if (trace.id !== traceId) return trace;
    changed = true;
    return update(trace);
  });
  if (!changed) return;
  setSnapshot({ ...snapshot, traces });
}

function getActiveTrace(): ReaderPerformanceTrace | null {
  if (!activeRuntime) return null;
  return (
    snapshot.traces.find((trace) => trace.id === activeRuntime?.traceId) ?? null
  );
}

export function subscribeReaderTraces(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReaderTraceSnapshot(): ReaderTraceSnapshot {
  return snapshot;
}

export function useReaderTraceSnapshot(): ReaderTraceSnapshot {
  return useSyncExternalStore(
    subscribeReaderTraces,
    getReaderTraceSnapshot,
    getReaderTraceSnapshot,
  );
}

export function setReaderTraceRecordingEnabled(enabled: boolean): void {
  try {
    getStorage()?.setItem(READER_TRACE_RECORDING_KEY, String(enabled));
  } catch {
    // The in-memory switch still works for this session.
  }

  if (!enabled && activeRuntime) {
    completeReaderTrace("interrupted", { reason: "recording-disabled" });
  }
  snapshot = { ...snapshot, recordingEnabled: enabled };
  emitChange();
}

export function beginReaderTrace(options: {
  bookId: string;
  bookTitle?: string;
  source: string;
}): string | null {
  if (!getDebugEnabled() || !snapshot.recordingEnabled) return null;

  const activeTrace = getActiveTrace();
  if (activeTrace?.bookId === options.bookId) return activeTrace.id;
  if (activeTrace) {
    completeReaderTrace("interrupted", { reason: "new-reader-open" });
  }

  const traceId = createId();
  const runtimeContext =
    typeof window === "undefined" ? undefined : window.__READER_TRACE_CONTEXT__;
  const trace: ReaderPerformanceTrace = {
    version: READER_TRACE_SCHEMA_VERSION,
    id: traceId,
    bookId: options.bookId,
    bookTitle: options.bookTitle ?? null,
    source: options.source,
    startedAt: Date.now(),
    durationMs: null,
    status: "recording",
    metadata: {
      ...(runtimeContext?.mainThreadCpuThrottleRate
        ? {
            mainThreadCpuThrottleRate: runtimeContext.mainThreadCpuThrottleRate,
          }
        : {}),
      ...(runtimeContext?.cpuThrottleScope
        ? { cpuThrottleScope: runtimeContext.cpuThrottleScope }
        : {}),
      ...(runtimeContext?.workerCpuThrottleRate
        ? { workerCpuThrottleRate: runtimeContext.workerCpuThrottleRate }
        : {}),
      ...(runtimeContext?.runLabel
        ? { runLabel: runtimeContext.runLabel }
        : {}),
    },
    spans: [],
  };

  activeRuntime = { traceId, startedAtMs: performance.now() };
  setSnapshot({
    ...snapshot,
    traces: [trace, ...snapshot.traces].slice(0, MAX_STORED_TRACES),
    activeTraceId: traceId,
  });
  markReaderTrace("open-intent", "navigation", { source: options.source });
  return traceId;
}

export function ensureReaderTrace(options: {
  bookId: string;
  bookTitle?: string;
  source?: string;
}): string | null {
  return beginReaderTrace({
    bookId: options.bookId,
    bookTitle: options.bookTitle,
    source: options.source ?? "direct-route",
  });
}

export function updateReaderTraceMetadata(
  details: ReaderTraceDetails,
  bookTitle?: string,
): void {
  if (!activeRuntime) return;
  updateTrace(activeRuntime.traceId, (trace) => ({
    ...trace,
    bookTitle: bookTitle ?? trace.bookTitle,
    metadata: { ...trace.metadata, ...details },
  }));
}

export function startReaderTraceSpan(
  name: string,
  lane: ReaderTraceLane,
  details: ReaderTraceDetails = {},
): ReaderTraceSpanToken | null {
  if (!activeRuntime) return null;

  const spanId = createId();
  const traceId = activeRuntime.traceId;
  updateTrace(traceId, (trace) => {
    if (trace.spans.length >= MAX_SPANS_PER_TRACE) {
      return {
        ...trace,
        metadata: {
          ...trace.metadata,
          droppedSpans:
            typeof trace.metadata.droppedSpans === "number"
              ? trace.metadata.droppedSpans + 1
              : 1,
        },
      };
    }

    return {
      ...trace,
      spans: [
        ...trace.spans,
        {
          id: spanId,
          name,
          lane,
          kind: "span",
          startMs: elapsedMs(),
          endMs: null,
          status: "running",
          details,
        },
      ],
    };
  });

  return { traceId, spanId };
}

export function endReaderTraceSpan(
  token: ReaderTraceSpanToken | null,
  details: ReaderTraceDetails = {},
  status: "ok" | "error" = "ok",
): void {
  if (!token || activeRuntime?.traceId !== token.traceId) return;
  const endedAt = elapsedMs();
  updateTrace(token.traceId, (trace) => ({
    ...trace,
    spans: trace.spans.map((span) =>
      span.id === token.spanId && span.status === "running"
        ? {
            ...span,
            endMs: endedAt,
            status,
            details: { ...span.details, ...details },
          }
        : span,
    ),
  }));
}

/** Records completed browser work whose Performance API timestamps predate the callback. */
export function recordReaderTraceSpan(options: {
  name: string;
  lane: ReaderTraceLane;
  startPerformanceMs: number;
  endPerformanceMs: number;
  details?: ReaderTraceDetails;
}): void {
  if (!activeRuntime) return;
  if (options.endPerformanceMs < activeRuntime.startedAtMs) return;

  const traceId = activeRuntime.traceId;
  const startMs = Math.max(
    0,
    options.startPerformanceMs - activeRuntime.startedAtMs,
  );
  const endMs = Math.max(
    startMs,
    options.endPerformanceMs - activeRuntime.startedAtMs,
  );
  updateTrace(traceId, (trace) => {
    if (trace.spans.length >= MAX_SPANS_PER_TRACE) return trace;
    return {
      ...trace,
      spans: [
        ...trace.spans,
        {
          id: createId(),
          name: options.name,
          lane: options.lane,
          kind: "span",
          startMs,
          endMs,
          status: "ok",
          details: options.details ?? {},
        },
      ],
    };
  });
}

export function markReaderTrace(
  name: string,
  lane: ReaderTraceLane,
  details: ReaderTraceDetails = {},
): void {
  if (!activeRuntime) return;
  const atMs = elapsedMs();
  const traceId = activeRuntime.traceId;
  updateTrace(traceId, (trace) => {
    if (trace.spans.length >= MAX_SPANS_PER_TRACE) return trace;
    return {
      ...trace,
      spans: [
        ...trace.spans,
        {
          id: createId(),
          name,
          lane,
          kind: "mark",
          startMs: atMs,
          endMs: atMs,
          status: "ok",
          details,
        },
      ],
    };
  });
}

export function markReaderTraceOnce(
  name: string,
  lane: ReaderTraceLane,
  details: ReaderTraceDetails = {},
): void {
  const activeTrace = getActiveTrace();
  if (
    activeTrace?.spans.some(
      (span) => span.kind === "mark" && span.name === name,
    )
  ) {
    return;
  }

  markReaderTrace(name, lane, details);
}

export function completeReaderTrace(
  status: "completed" | "error" | "interrupted" = "completed",
  details: ReaderTraceDetails = {},
): void {
  if (!activeRuntime) return;
  const traceId = activeRuntime.traceId;
  const durationMs = elapsedMs();
  updateTrace(traceId, (trace) => ({
    ...trace,
    durationMs,
    status,
    metadata: { ...trace.metadata, ...details },
    spans: trace.spans.map((span) =>
      span.status === "running"
        ? {
            ...span,
            endMs: durationMs,
            status:
              status === "completed" ? ("ok" as const) : ("error" as const),
          }
        : span,
    ),
  }));
  activeRuntime = null;
  snapshot = { ...snapshot, activeTraceId: null };
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  persistTraces(snapshot.traces);
  emitChange();
}

export function clearReaderTraces(): void {
  const activeTrace = getActiveTrace();
  setSnapshot({
    ...snapshot,
    traces: activeTrace ? [activeTrace] : [],
    activeTraceId: activeTrace?.id ?? null,
  });
}

export async function withReaderTraceSpan<T>(
  name: string,
  lane: ReaderTraceLane,
  operation: () => Promise<T>,
  details: ReaderTraceDetails = {},
): Promise<T> {
  const token = startReaderTraceSpan(name, lane, details);
  try {
    const result = await operation();
    endReaderTraceSpan(token);
    return result;
  } catch (error) {
    endReaderTraceSpan(
      token,
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
    throw error;
  }
}

/** Debug mode is the master gate; the saved recording choice remains independent. */
function getRecordingActive(): boolean {
  return getDebugEnabled() && snapshot.recordingEnabled;
}

export function useReaderTraceRecordingActive(): boolean {
  return useSyncExternalStore(
    subscribeReaderTraces,
    getRecordingActive,
    getRecordingActive,
  );
}

const unsubscribeDebug = subscribeDebugPreference(() => {
  if (!getDebugEnabled() && activeRuntime) {
    completeReaderTrace("interrupted", { reason: "debug-disabled" });
  }
  emitChange();
});

if (import.meta.hot) import.meta.hot.dispose(unsubscribeDebug);

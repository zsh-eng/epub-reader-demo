import { comparisonKey } from "../../shared/protocol";
import { useSyncExternalStore } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type {
  Branch,
  Commit,
  Comparison,
  NoteMutation,
  NoteState,
  ReviewResponse,
  Session,
  SourceResponse,
} from "../../shared/protocol";
import {
  createInitialReviewState,
  parseReviewPatch,
  projectAuthoritativeNotes,
  projectResponse,
  reduceReviewState,
  reviewFileMatchesFilter,
  type ParsedReviewFile,
  type ReviewDocumentV1,
  type ReviewState,
} from "../../shared/review";
import { ByteLru, estimateRetainedBytes } from "./cache";
import {
  branchesSchema,
  createApi,
  eventSchema,
  historySchema,
  HttpError,
  notesSchema,
  reviewSchema,
  sessionSchema,
  sourceSchema,
} from "./api";
import { readServerEvents } from "./sse";

export type { ParsedReviewFile } from "../../shared/review";
export interface ReviewControllerSnapshot {
  session: Session | null;
  branches: Branch[];
  branchesError: string | null;
  activeBranch: string | null;
  historyRef: string | null;
  sourceRevision: number;
  history: Commit[];
  historyHasMore: boolean;
  historyLoading: boolean;
  historyError: string | null;
  review: ReviewResponse | null;
  files: ParsedReviewFile[];
  visibleFiles: ParsedReviewFile[];
  notes: NoteState | null;
  notesError: string | null;
  comparison: Comparison;
  selectedFileId: string | null;
  filter: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  connection: "connecting" | "connected" | "reconnecting" | "closed";
  metrics: { requestMs: number; parseMs: number; cacheHit: boolean } | null;
  semantic: ReviewState | null;
}

export interface ReviewControllerOptions {
  token?: string;
  fetch?: typeof fetch;
  parsePatch?: (patch: string) => Promise<FileDiffMetadata[]>;
  cacheBytes?: number;
  events?: boolean;
}

export interface ReviewController {
  getSnapshot(): ReviewControllerSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  selectComparison(comparison: Comparison): Promise<void>;
  refresh(): Promise<void>;
  loadMoreHistory(): Promise<void>;
  selectWorktree(path: string): Promise<void>;
  selectBranch(name: string): Promise<void>;
  revealFile(id: string): void;
  setFilter(text: string): void;
  loadSources(path: string): Promise<SourceResponse>;
  mutateNote(mutation: NoteMutation): Promise<void>;
  dispose(): void;
}

interface CachedReview {
  response: ReviewResponse;
  files: ParsedReviewFile[];
  document: ReviewDocumentV1;
}
function immutableComparison(comparison: Comparison): boolean {
  const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
  return comparison.kind === "commit"
    ? objectId.test(comparison.commit)
    : comparison.kind === "range" &&
        objectId.test(comparison.base) &&
        objectId.test(comparison.head);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
function query(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

export function createReviewController(options: ReviewControllerOptions = {}): ReviewController {
  const token =
    options.token ??
    (typeof location === "undefined"
      ? ""
      : (new URLSearchParams(location.hash.slice(1)).get("token") ?? ""));
  const api = createApi(options.fetch ?? globalThis.fetch.bind(globalThis), token);
  const parse =
    options.parsePatch ??
    (async (patch: string) => {
      if (patch.length > 256 * 1024) throw new Error("This patch requires the background parser.");
      return parseReviewPatch(patch);
    });
  const reviewCache = new ByteLru<CachedReview>(options.cacheBytes ?? 24 * 1024 * 1024);
  const sourceCache = new ByteLru<SourceResponse>(8 * 1024 * 1024, 12, (_key, source) => {
    if (snapshot.review?.id !== source.reviewId || !snapshot.semantic) return;
    const file = snapshot.files.find((entry) => entry.path === source.path);
    if (!file) return;
    const sourceStatusByFileKey = { ...snapshot.semantic.sourceStatusByFileKey };
    delete sourceStatusByFileKey[file.id];
    update({ semantic: { ...snapshot.semantic, sourceStatusByFileKey } });
  });
  const listeners = new Set<() => void>();
  let snapshot: ReviewControllerSnapshot = {
    session: null,
    branches: [],
    branchesError: null,
    activeBranch: null,
    historyRef: null,
    sourceRevision: 0,
    history: [],
    historyHasMore: false,
    historyLoading: false,
    historyError: null,
    review: null,
    files: [],
    visibleFiles: [],
    notes: null,
    notesError: null,
    comparison: { kind: "working" },
    selectedFileId: null,
    filter: "",
    status: "idle",
    error: null,
    connection: "closed",
    metrics: null,
    semantic: null,
  };
  let homeRepo: string | undefined;
  let branchGeneration = 0;
  let branchAbort: AbortController | undefined;
  let disposed = false;
  let workspaceGeneration = 0;
  let reviewGeneration = 0;
  let historyGeneration = 0;
  let historyCursor: string | null = null;
  let reviewAbort: AbortController | undefined;
  let sessionAbort: AbortController | undefined;
  let historyAbort: AbortController | undefined;
  let eventAbort: AbortController | undefined;
  let eventTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 500;
  const sourceRequests = new Map<
    string,
    { abort: AbortController; promise: Promise<SourceResponse> }
  >();
  const update = (patch: Partial<ReviewControllerSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const isCurrent = (generation: number) => !disposed && generation === reviewGeneration;
  const filtered = (files: ParsedReviewFile[], filter: string) =>
    files.filter((file) =>
      reviewFileMatchesFilter({ path: file.path, previousPath: file.info.previousPath }, filter),
    );
  const cancelSources = () => {
    for (const { abort } of sourceRequests.values()) abort.abort();
    sourceRequests.clear();
  };

  async function loadNotes(reviewId: string, generation: number): Promise<void> {
    try {
      const notes = await api.json(`/api/notes?${query({ reviewId })}`, notesSchema, {
        signal: reviewAbort?.signal,
      });
      if (!isCurrent(generation) || snapshot.review?.id !== reviewId) return;
      if (notes.reviewId !== reviewId) throw new Error("Notes belong to a different review.");
      if (snapshot.notes?.reviewId === notes.reviewId && snapshot.notes.revision > notes.revision)
        return;
      update({
        notes,
        notesError: null,
        semantic: snapshot.semantic ? projectAuthoritativeNotes(snapshot.semantic, notes) : null,
      });
    } catch (error) {
      if (isCurrent(generation) && snapshot.review?.id === reviewId)
        update({ notesError: message(error) });
    }
  }

  function publishReview(
    entry: CachedReview,
    generation: number,
    metrics: NonNullable<ReviewControllerSnapshot["metrics"]>,
  ) {
    if (!isCurrent(generation)) return;
    const oldSemantic = snapshot.semantic;
    const semantic = oldSemantic
      ? reduceReviewState(oldSemantic, { type: "document/reconcile", document: entry.document })
      : createInitialReviewState(entry.document, { showAgentNotes: true });
    // Notes are scoped to the authoritative review ID. Never show another commit's notes.
    const sameReview = snapshot.review?.id === entry.response.id;
    const reconciled = sameReview
      ? semantic
      : { ...semantic, userNotes: [], liveNotes: [], draftNote: null };
    // Pierre hydrates partial metadata in place. Keep renderer-owned metadata separate
    // from the canonical entries whose retained size is measured by the review LRU.
    // Re-selecting the same review must retain the exact metadata objects.
    // Pierre compares prepared and rendered layouts by object identity, even
    // when their cache keys match. Replacing these during highlighting races
    // with its existing render cache and can fail finalizeRender.
    const files = sameReview
      ? snapshot.files
      : entry.files.map((file) => ({
          ...file,
          metadata: file.metadata ? structuredClone(file.metadata) : null,
        }));
    const visibleFiles = filtered(files, snapshot.filter);
    const selectedFileId = visibleFiles.some((file) => file.id === snapshot.selectedFileId)
      ? snapshot.selectedFileId
      : (visibleFiles[0]?.id ?? null);
    update({
      review: entry.response,
      files,
      visibleFiles,
      selectedFileId,
      semantic: reconciled,
      notes: sameReview ? snapshot.notes : null,
      notesError: null,
      status: "ready",
      error: null,
      metrics,
    });
    void loadNotes(entry.response.id, generation);
  }

  async function selectComparison(comparison: Comparison, force = false): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (!repo || disposed) return;
    if (
      snapshot.session?.repository.git === false &&
      comparison.kind !== "patch" &&
      comparison.kind !== "files"
    ) {
      update({ error: "Git comparisons are not available for this input." });
      return;
    }
    if (snapshot.historyRef && ["working", "staged", "unstaged"].includes(comparison.kind)) {
      update({
        error: "This branch has no worktree. Choose a worktree tab to review working changes.",
      });
      return;
    }
    const generation = ++reviewGeneration;
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    cancelSources();
    update({ comparison, status: "loading", error: null });
    const key = JSON.stringify([repo, comparisonKey(comparison)]);
    const cached = !force && immutableComparison(comparison) ? reviewCache.get(key) : undefined;
    if (cached) {
      publishReview(cached, generation, { requestMs: 0, parseMs: 0, cacheHit: true });
      return;
    }
    const start = performance.now();
    try {
      const response = await api.json("/api/review", reviewSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, comparison }),
        signal: reviewAbort.signal,
      });
      if (!isCurrent(generation)) return;
      if (
        response.repo !== repo ||
        comparisonKey(response.comparison) !== comparisonKey(comparison)
      ) {
        console.error("Comparison response mismatch", {
          requested: { repo, comparison },
          received: { repo: response.repo, comparison: response.comparison },
        });
        throw new Error(
          "The server returned a different comparison. Restart the server and reload this page if you have just updated the app.",
        );
      }
      const parseStart = performance.now();
      const parsed = await parse(response.patch);
      if (!isCurrent(generation)) return;
      const { files, document } = projectResponse(response, parsed);
      const entry = { response, files, document };
      if (immutableComparison(comparison))
        reviewCache.set(key, entry, estimateRetainedBytes(entry));
      publishReview(entry, generation, {
        requestMs: parseStart - start,
        parseMs: performance.now() - parseStart,
        cacheHit: false,
      });
    } catch (error) {
      if (isCurrent(generation)) update({ status: "error", error: message(error) });
    }
  }

  async function loadHistory(reset: boolean): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (snapshot.session?.repository.git === false) return;
    if (!repo || disposed || (!reset && (snapshot.historyLoading || !snapshot.historyHasMore)))
      return;
    const generation = ++historyGeneration;
    historyAbort?.abort();
    historyAbort = new AbortController();
    update({ historyLoading: true, historyError: null });
    try {
      const args: Record<string, string> = { repo, limit: "50" };
      if (snapshot.historyRef) args.ref = snapshot.historyRef;
      if (!reset && historyCursor) args.cursor = historyCursor;
      const page = await api.json(`/api/history?${query(args)}`, historySchema, {
        signal: historyAbort.signal,
      });
      if (disposed || generation !== historyGeneration) return;
      const existing = reset ? [] : snapshot.history;
      const ids = new Set(existing.map((commit) => commit.id));
      const history = [...existing, ...page.commits.filter((commit) => !ids.has(commit.id))];
      historyCursor = page.cursor;
      update({
        history,
        historyHasMore: page.hasMore && page.cursor !== null,
        historyLoading: false,
      });
    } catch (error) {
      if (!disposed && generation === historyGeneration)
        update({ historyError: message(error), historyLoading: false });
    }
  }

  async function loadBranches(refreshSession = false): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (!repo || snapshot.session?.repository.git === false || disposed) return;
    const generation = ++branchGeneration;
    branchAbort?.abort();
    branchAbort = new AbortController();
    try {
      const branches = await api.json(`/api/branches?${query({ repo })}`, branchesSchema, {
        signal: branchAbort.signal,
      });
      const session = refreshSession
        ? await api.json(`/api/session?${query({ repo })}`, sessionSchema, {
            signal: branchAbort.signal,
          })
        : null;
      if (!disposed && generation === branchGeneration) {
        update({
          branches,
          branchesError: null,
          ...(session
            ? {
                session,
                ...(!snapshot.historyRef
                  ? {
                      activeBranch:
                        session.repository.branch === "Detached HEAD"
                          ? null
                          : session.repository.branch,
                    }
                  : {}),
              }
            : {}),
        });
      }
    } catch (error) {
      if (!disposed && generation === branchGeneration) update({ branchesError: message(error) });
    }
  }
  async function refresh(): Promise<void> {
    update({ sourceRevision: snapshot.sourceRevision + 1 });
    await Promise.all([
      selectComparison(snapshot.comparison, true),
      loadHistory(true),
      loadBranches(true),
    ]);
  }

  function stopEvents() {
    eventAbort?.abort();
    eventAbort = undefined;
    clearTimeout(eventTimer);
    clearTimeout(refreshTimer);
  }

  function startEvents() {
    stopEvents();
    if (options.events === false || disposed) return;
    const workspace = workspaceGeneration;
    const repo = snapshot.session?.repository.path;
    let lastRevision: number | undefined;
    let connections = 0;
    const connect = async () => {
      if (disposed || workspace !== workspaceGeneration) return;
      const abort = new AbortController();
      eventAbort = abort;
      update({ connection: reconnectDelay > 500 ? "reconnecting" : "connecting" });
      try {
        const response = await api.stream(
          `/api/events?${query({ repo: repo ?? "" })}`,
          abort.signal,
        );
        if (!response.ok || !response.body)
          throw new HttpError("Live updates are unavailable.", response.status);
        if (disposed || workspace !== workspaceGeneration || abort.signal.aborted) {
          await response.body.cancel();
          return;
        }
        connections += 1;
        update({ connection: "connected" });
        await readServerEvents(
          response.body,
          (event) => {
            if (workspace !== workspaceGeneration || disposed) return;
            let raw: unknown;
            try {
              raw = JSON.parse(event.data);
            } catch {
              return;
            }
            const result = eventSchema.safeParse(raw);
            if (!result.success || result.data.repo !== repo) return;
            const notice = result.data;
            // Reconnect always reconciles: events may have been missed while disconnected.
            const needsRefresh =
              notice.type === "changed" ||
              connections > 1 ||
              (lastRevision !== undefined && lastRevision !== notice.revision);
            lastRevision = notice.revision;
            reconnectDelay = 500;
            if (needsRefresh) {
              clearTimeout(refreshTimer);
              refreshTimer = setTimeout(() => {
                update({ sourceRevision: snapshot.sourceRevision + 1 });
                void loadHistory(true);
                void loadBranches(true);
                if (!immutableComparison(snapshot.comparison))
                  void selectComparison(snapshot.comparison, true);
              }, 150);
            }
          },
          abort.signal,
        );
      } catch (error) {
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          update({
            connection: "closed",
            error: "The session token has expired. Open the address shown by the server.",
          });
          return;
        }
      }
      if (disposed || workspace !== workspaceGeneration || abort.signal.aborted) return;
      update({ connection: "reconnecting" });
      eventTimer = setTimeout(() => {
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
    };
    void connect();
  }

  async function openWorkspace(path?: string, branch?: Branch): Promise<void> {
    if (disposed) return;
    const generation = ++workspaceGeneration;
    ++branchGeneration;
    branchAbort?.abort();
    ++reviewGeneration;
    ++historyGeneration;
    sessionAbort?.abort();
    sessionAbort = new AbortController();
    reviewAbort?.abort();
    historyAbort?.abort();
    cancelSources();
    stopEvents();
    sourceCache.clear();
    historyCursor = null;
    update({
      session: null,
      status: "loading",
      error: null,
      history: [],
      historyHasMore: false,
      historyLoading: false,
      historyError: null,
      review: null,
      files: [],
      visibleFiles: [],
      semantic: null,
      notes: null,
      selectedFileId: null,
    });
    try {
      const session = await api.json(
        `/api/session${path ? `?${query({ repo: path })}` : ""}`,
        sessionSchema,
        { signal: sessionAbort.signal },
      );
      if (disposed || generation !== workspaceGeneration) return;
      homeRepo ??= session.repository.path;
      const branchSnapshot =
        branch && (!branch.worktreePath || session.repository.branch !== branch.name);
      const comparison = branchSnapshot
        ? { kind: "commit" as const, commit: branch.head }
        : ((!path && !branch ? session.initialComparison : undefined) ?? {
            kind: "working" as const,
          });
      update({
        session,
        comparison,
        activeBranch:
          branch?.name ??
          (session.repository.branch === "Detached HEAD"
            ? null
            : session.repository.branch || null),
        historyRef: branchSnapshot ? `refs/heads/${branch.name}` : null,
      });
      startEvents();
      await Promise.all([selectComparison(comparison), loadHistory(true), loadBranches()]);
    } catch (error) {
      if (!disposed && generation === workspaceGeneration)
        update({ status: "error", error: message(error) });
    }
  }

  async function loadSources(path: string): Promise<SourceResponse> {
    const review = snapshot.review;
    if (!review || snapshot.status !== "ready")
      throw new Error("Wait for the current review to load.");
    if (!snapshot.files.some((file) => file.path === path))
      throw new Error("This file is not in the current review.");
    const generation = reviewGeneration;
    const key = JSON.stringify([review.id, path]);
    const file = snapshot.files.find((entry) => entry.path === path)!;
    const setSourceStatus = (
      status: { kind: "loading" } | { kind: "loaded"; text: string } | { kind: "error" },
    ) => {
      if (isCurrent(generation) && snapshot.semantic)
        update({
          semantic: reduceReviewState(snapshot.semantic, {
            type: "expansion/set-source-status",
            fileKey: file.id,
            status,
          }),
        });
    };
    const cached = sourceCache.get(key);
    if (cached) {
      setSourceStatus({ kind: "loaded", text: file.info.status === "D" ? cached.old : cached.new });
      return cached;
    }
    const pending = sourceRequests.get(key);
    if (pending) return pending.promise;
    if (sourceRequests.size >= 4)
      throw new Error("Four files are loading. Wait before expanding another file.");
    const abort = new AbortController();
    setSourceStatus({ kind: "loading" });
    const promise = api
      .json(`/api/source?${query({ reviewId: review.id, path })}`, sourceSchema, {
        signal: abort.signal,
      })
      .then((source) => {
        if (!isCurrent(generation)) throw new DOMException("The review changed.", "AbortError");
        if (source.reviewId !== review.id || source.path !== path)
          throw new Error("The source belongs to a different file version.");
        const bytes = estimateRetainedBytes(source);
        sourceCache.set(key, source, bytes);
        if (bytes <= sourceCache.maxBytes)
          setSourceStatus({
            kind: "loaded",
            text: file.info.status === "D" ? source.old : source.new,
          });
        else setSourceStatus({ kind: "error" });
        return source;
      })
      .catch((error: unknown) => {
        setSourceStatus({ kind: "error" });
        throw error;
      })
      .finally(() => {
        if (sourceRequests.get(key)?.abort === abort) sourceRequests.delete(key);
      });
    sourceRequests.set(key, { abort, promise });
    return promise;
  }

  async function mutateNote(mutation: NoteMutation): Promise<void> {
    const review = snapshot.review;
    const current = snapshot.notes;
    if (!review || !current || current.reviewId !== review.id || snapshot.status !== "ready")
      throw new Error("Wait for notes to load.");
    const generation = reviewGeneration;
    try {
      const notes = await api.json("/api/notes", notesSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: review.id, expectedRevision: current.revision, mutation }),
        signal: reviewAbort?.signal,
      });
      if (!isCurrent(generation)) return;
      if (notes.reviewId !== review.id) throw new Error("Notes belong to a different review.");
      if (snapshot.notes && notes.revision < snapshot.notes.revision) return;
      update({
        notes,
        notesError: null,
        semantic: snapshot.semantic ? projectAuthoritativeNotes(snapshot.semantic, notes) : null,
      });
    } catch (error) {
      if (isCurrent(generation)) {
        if (error instanceof HttpError && error.status === 409)
          await loadNotes(review.id, generation);
        if (isCurrent(generation)) update({ notesError: message(error) });
      }
      throw error;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: () => openWorkspace(),
    selectWorktree(path) {
      if (snapshot.session?.repository.git === false) {
        update({ error: "Worktrees are not available for this input." });
        return Promise.resolve();
      }
      return openWorkspace(path);
    },
    selectBranch(name) {
      const branch = snapshot.branches.find((entry) => entry.name === name);
      if (!branch || !homeRepo || snapshot.session?.repository.git === false)
        return Promise.resolve();
      return openWorkspace(branch.worktreePath ?? homeRepo, branch);
    },
    selectComparison: (comparison) => selectComparison(comparison),
    refresh,
    loadMoreHistory: () => loadHistory(false),
    loadSources,
    mutateNote,
    revealFile(id) {
      if (!snapshot.files.some((file) => file.id === id)) return;
      const semantic = snapshot.semantic
        ? reduceReviewState(snapshot.semantic, {
            type: "selection/select",
            fileKey: id,
            hunkIndex: 0,
            reveal: { anchor: "file-top", scrollToNote: false },
          })
        : null;
      update({ selectedFileId: id, semantic });
    },
    setFilter(filter) {
      const visibleFiles = filtered(snapshot.files, filter);
      const selectedFileId = visibleFiles.some((file) => file.id === snapshot.selectedFileId)
        ? snapshot.selectedFileId
        : (visibleFiles[0]?.id ?? null);
      const semantic = snapshot.semantic
        ? reduceReviewState(snapshot.semantic, { type: "filter/set", filter })
        : null;
      update({ filter, visibleFiles, selectedFileId, semantic });
    },
    dispose() {
      disposed = true;
      ++branchGeneration;
      branchAbort?.abort();
      ++workspaceGeneration;
      ++reviewGeneration;
      ++historyGeneration;
      sessionAbort?.abort();
      reviewAbort?.abort();
      historyAbort?.abort();
      stopEvents();
      cancelSources();
      reviewCache.clear();
      sourceCache.clear();
      listeners.clear();
    },
  };
}

export function useReviewController(controller: ReviewController): ReviewControllerSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

import * as stylex from "@stylexjs/stylex";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Comparison, Note } from "../shared/protocol";
import { useReviewController, type ReviewController } from "./data/controller";
import { tokens, ui } from "./theme.stylex";
import { ActionMenu, ChoiceSelect, CommandDialog, type ReviewCommand } from "./components/Controls";
import { HistoryPanel } from "./components/HistoryPanel";
import { FileSidebar } from "./components/FileSidebar";
import { GutterNoteButton, NoteCard, NoteComposer, type NoteTarget } from "./components/NoteCard";
import { Icon } from "./components/Icon";
import "./pierre-theme";
import { useTheme } from "./themes";
import { ThemePicker } from "./components/ThemePicker";
import { BranchTabs } from "./components/BranchTabs";
import type { BrowseSource } from "../shared/browse";
import { createBrowseApi, useBrowseFiles, type BrowseApi } from "./data/browse";
import { createFileWorkspace, sourceKey, useFileWorkspace } from "./data/file-workspace";
import { RepositoryFiles } from "./components/RepositoryFiles";
import { FilePicker } from "./components/FilePicker";
import { FullFileView } from "./components/FullFileView";
import { FileViewTabs } from "./components/FileViewTabs";
import { createBlameLoader, type BlameLoader } from "./data/blame";

type Annotation = { note?: Note; draft?: NoteTarget };
type Selection = {
  id: string;
  range: {
    start: number;
    end: number;
    side?: "additions" | "deletions";
    endSide?: "additions" | "deletions";
  };
};
const emptyNotes: Note[] = [];

function readPreference<T extends string>(key: string, fallback: T, values: readonly T[]): T {
  try {
    const value = localStorage.getItem(`med:${key}`);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function App({
  controller,
  browseApi: providedBrowseApi,
  loadBlame: providedBlameLoader,
}: {
  controller: ReviewController;
  browseApi?: BrowseApi;
  loadBlame?: BlameLoader;
}) {
  const state = useReviewController(controller);
  const { active: activeTheme } = useTheme();
  const theme = activeTheme.appearance;
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [filesVisible, setFilesVisible] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"files" | "content">("files");
  const [pickerResume, setPickerResume] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [blameEnabled, setBlameEnabled] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [browseApi] = useState(
    () =>
      providedBrowseApi ??
      createBrowseApi(
        globalThis.fetch.bind(globalThis),
        new URLSearchParams(location.hash.slice(1)).get("token") ?? "",
      ),
  );
  const [fileWorkspace] = useState(() => createFileWorkspace(browseApi));
  const [loadBlame] = useState(
    () =>
      providedBlameLoader ??
      createBlameLoader(
        globalThis.fetch.bind(globalThis),
        new URLSearchParams(location.hash.slice(1)).get("token") ?? "",
      ),
  );
  const fileState = useFileWorkspace(fileWorkspace);
  const branchHead = state.branches.find((branch) => branch.name === state.activeBranch)?.head;
  const browseSource = useMemo<BrowseSource | null>(() => {
    const repository = state.session?.repository;
    if (!repository || repository.git === false) return null;
    if (state.historyRef)
      return branchHead ? { kind: "commit", repo: repository.path, oid: branchHead } : null;
    return { kind: "worktree", repo: repository.path };
  }, [state.session?.repository, state.historyRef, branchHead]);
  const workspaceKey = state.session
    ? `${state.session.repository.path}:${state.activeBranch ?? "detached"}`
    : "";
  const sourceLabel =
    browseSource?.kind === "commit"
      ? `Commit ${browseSource.oid.slice(0, 7)} · ${state.activeBranch ?? "snapshot"}`
      : `Working files · ${state.activeBranch ?? "detached worktree"}`;
  useEffect(() => {
    fileWorkspace.configure(workspaceKey, browseSource, sourceLabel);
  }, [fileWorkspace, workspaceKey, browseSource, sourceLabel]);
  useEffect(() => () => fileWorkspace.dispose(), [fileWorkspace]);
  const repositoryFiles = useBrowseFiles(
    browseSource,
    filesVisible || filePickerOpen,
    browseSource?.kind === "worktree" ? state.sourceRevision : 0,
    { api: browseApi },
  );
  useEffect(() => {
    fileWorkspace.invalidate();
  }, [fileWorkspace, state.sourceRevision]);
  const activeFile = fileState.tabs.find((tab) => tab.id === fileState.active);
  const openFilePicker = useCallback(() => {
    setPickerMode("files");
    setPickerResume(false);
    setFilePickerOpen(true);
  }, []);
  const openContentSearch = useCallback(() => {
    setPickerMode("content");
    setPickerResume(false);
    setFilePickerOpen(true);
  }, []);
  const resumeFilePicker = useCallback(() => {
    setPickerResume(true);
    setFilePickerOpen(true);
  }, []);
  const showFiles = useCallback(() => {
    setFilesVisible(true);
    if (window.innerWidth < 1100) setSidebarVisible(false);
  }, []);
  const toggleFilesSidebar = useCallback(() => {
    if (filesVisible) setFilesVisible(false);
    else showFiles();
  }, [filesVisible, showFiles]);
  const toggleReviewSidebar = useCallback(() => {
    setSidebarVisible((visible) => {
      if (!visible && window.innerWidth < 1100) setFilesVisible(false);
      return !visible;
    });
  }, []);
  const [mode, setMode] = useState<"split" | "unified">(() =>
    readPreference("mode", "split", ["split", "unified"]),
  );
  const [wrap, setWrap] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<NoteTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [contextError, setContextError] = useState<string | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("HEAD");
  const [rangeOpen, setRangeOpen] = useState(false);
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const reviewScroll = useRef(0);
  const explicitReveal = useRef(false);
  useEffect(() => {
    if (fileState.active !== "changes") return;
    if (explicitReveal.current) {
      explicitReveal.current = false;
      return;
    }
    const frame = requestAnimationFrame(() =>
      viewer.current?.scrollTo({ type: "position", position: reviewScroll.current }),
    );
    return () => cancelAnimationFrame(frame);
  }, [fileState.active]);
  const metadataRows = useRef(new Map<string, HTMLDivElement>());
  const filterRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const renderStart = useRef({ id: "", at: 0, measured: true, generation: 0 });
  useEffect(() => {
    let previousMetrics = controller.getSnapshot().metrics;
    return controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      const id = snapshot.review?.id ?? "";
      if (renderStart.current.id !== id) {
        setSelection(null);
        setDraft(null);
        setContextError(null);
      }
      if (snapshot.status === "loading") {
        renderStart.current = {
          id,
          at: 0,
          measured: true,
          generation: renderStart.current.generation + 1,
        };
        setFrameMs(null);
      } else if (snapshot.metrics !== previousMetrics) {
        renderStart.current = {
          id,
          at: performance.now(),
          measured: false,
          generation: renderStart.current.generation + 1,
        };
        setFrameMs(null);
      }
      previousMetrics = snapshot.metrics;
    });
  }, [controller]);
  const files = state.visibleFiles;
  const notes = state.notes?.notes ?? emptyNotes;
  const selectedFile = files.find((file) => file.id === state.selectedFileId);

  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    try {
      localStorage.setItem("med:mode", mode);
    } catch {
      /* Preferences can be unavailable in private storage. */
    }
  }, [mode]);
  const reveal = useCallback(
    (id: string) => {
      explicitReveal.current = fileWorkspace.getSnapshot().active !== "changes";
      fileWorkspace.select("changes");
      controller.revealFile(id);
      setCollapsed((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      requestAnimationFrame(() => {
        const row = metadataRows.current.get(id);
        if (row) row.scrollIntoView({ block: "nearest" });
        else viewer.current?.scrollTo({ type: "item", id, align: "start" });
      });
    },
    [controller, fileWorkspace],
  );
  useEffect(() => {
    if (!state.selectedFileId) return;
    const row = metadataRows.current.get(state.selectedFileId);
    if (row) row.scrollIntoView({ block: "nearest" });
    else viewer.current?.scrollTo({ type: "item", id: state.selectedFileId, align: "nearest" });
  }, [state.selectedFileId]);

  // Pierre treats a matching version as an instruction to keep the old item.
  // Use a monotonic revision: numeric hashes can collide and retain old portals.
  const itemKey = JSON.stringify([
    state.review?.id,
    state.notes?.revision,
    showNotes,
    draft,
    [...collapsed],
  ]);
  const [itemVersion, setItemVersion] = useState({ key: itemKey, files, value: 0 });
  let currentVersion = itemVersion.value;
  if (itemVersion.key !== itemKey || itemVersion.files !== files) {
    currentVersion++;
    setItemVersion({ key: itemKey, files, value: currentVersion });
  }
  const items = useMemo<CodeViewItem<Annotation>[]>(() => {
    return files.flatMap((file) => {
      if (!file.metadata) return [];
      const annotations: DiffLineAnnotation<Annotation>[] = showNotes
        ? notes
            .filter(
              (note) =>
                note.path === file.path &&
                !note.parentId &&
                note.resolution !== "orphaned" &&
                note.resolution !== "stale",
            )
            .map((note) => ({
              side: note.side === "old" ? "deletions" : "additions",
              lineNumber: note.line,
              metadata: { note },
            }))
        : [];
      if (draft?.path === file.path)
        annotations.push({
          side: draft.side === "old" ? "deletions" : "additions",
          lineNumber: draft.line,
          metadata: { draft },
        });
      return [
        {
          id: file.id,
          type: "diff" as const,
          fileDiff: file.metadata,
          version: currentVersion,
          collapsed: collapsed.has(file.id),
          annotations,
        },
      ];
    });
  }, [files, notes, showNotes, draft, collapsed, currentVersion]);

  const options = useMemo<CodeViewReactOptions<Annotation, undefined>>(
    () => ({
      theme: activeTheme.pierreTheme,
      themeType: theme,
      diffStyle: mode,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      stickyHeaders: true,
      enableLineSelection: true,
      enableGutterUtility: true,
      hunkSeparators: "line-info",
      layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
      loadDiffFiles: async (metadata: FileDiffMetadata) => {
        try {
          const source = await controller.loadSources(metadata.name);
          setContextError(null);
          return {
            oldFile:
              metadata.type === "rename-pure"
                ? null
                : {
                    name: metadata.prevName ?? metadata.name,
                    contents: source.old,
                    cacheKey: `${source.reviewId}:${source.path}:old`,
                  },
            newFile: {
              name: metadata.name,
              contents: source.new,
              cacheKey: `${source.reviewId}:${source.path}:new`,
            },
          };
        } catch (error) {
          setContextError(error instanceof Error ? error.message : "Could not load file context");
          throw error;
        }
      },
      onPostRender: (_node, _instance, phase) => {
        if (phase === "unmount" || renderStart.current.measured) return;
        renderStart.current.measured = true;
        const generation = renderStart.current.generation;
        const start = renderStart.current.at;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (renderStart.current.generation === generation)
              setFrameMs(performance.now() - start);
          }),
        );
      },
    }),
    [controller, theme, activeTheme.pierreTheme, mode, wrap],
  );

  const hits = useMemo(() => {
    if (!find) return [];
    const query = find.toLowerCase();
    const result: { id: string; side: "additions" | "deletions"; line: number }[] = [];
    for (const file of files) {
      const metadata = file.metadata;
      if (!metadata) continue;
      for (const hunk of metadata.hunks) {
        let found = false;
        for (const side of ["additions", "deletions"] as const) {
          const source = side === "additions" ? metadata.additionLines : metadata.deletionLines;
          const index = side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
          const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
          const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
          for (let offset = 0; offset < count; offset++)
            if (source[index + offset]?.toLowerCase().includes(query)) {
              result.push({ id: file.id, side, line: start + offset });
              found = true;
              break;
            }
          if (found) break;
        }
      }
    }
    return result;
  }, [files, find]);
  const jumpHit = useCallback(
    (index: number) => {
      if (!hits.length) return;
      const next = (index + hits.length) % hits.length;
      setFindIndex(next);
      const hit = hits[next];
      controller.revealFile(hit.id);
      setSelection({ id: hit.id, range: { start: hit.line, end: hit.line, side: hit.side } });
      viewer.current?.scrollTo({
        type: "line",
        id: hit.id,
        lineNumber: hit.line,
        side: hit.side,
        align: "center",
      });
    },
    [controller, hits],
  );
  const startNote = useCallback(() => {
    if (!selection) return;
    const file = files.find((entry) => entry.id === selection.id);
    if (!file) return;
    if (selection.range.endSide && selection.range.side !== selection.range.endSide) {
      setContextError("Select lines on one side to add a note.");
      return;
    }
    setShowNotes(true);
    setDraft({
      path: file.path,
      side: selection.range.side === "deletions" ? "old" : "new",
      line: Math.min(selection.range.start, selection.range.end),
      endLine: Math.max(selection.range.start, selection.range.end),
    });
  }, [selection, files]);
  const navigateFile = useCallback(
    (delta: number) => {
      const index = files.findIndex((file) => file.id === state.selectedFileId);
      const next = files[Math.max(0, Math.min(files.length - 1, index + delta))];
      if (next) reveal(next.id);
    },
    [files, state.selectedFileId, reveal],
  );
  const navigateHunk = useCallback(
    (delta: number) => {
      const targets = files.flatMap(
        (file) =>
          file.metadata?.hunks.map((hunk) => ({
            id: file.id,
            side: hunk.additionCount > 0 ? ("additions" as const) : ("deletions" as const),
            line: hunk.additionCount > 0 ? hunk.additionStart : hunk.deletionStart,
          })) ?? [],
      );
      const current = targets.findIndex(
        (target) =>
          target.id === (selection?.id ?? state.selectedFileId) &&
          (!selection || target.line >= selection.range.start),
      );
      const target = targets[Math.max(0, Math.min(targets.length - 1, current + delta))];
      if (target) {
        controller.revealFile(target.id);
        setSelection({
          id: target.id,
          range: { start: target.line, end: target.line, side: target.side },
        });
        viewer.current?.scrollTo({
          type: "line",
          id: target.id,
          side: target.side,
          lineNumber: target.line,
          align: "start",
        });
      }
    },
    [files, selection, state.selectedFileId, controller],
  );
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.focus());
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const editing = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) || node.isContentEditable),
        );
      if (event.isComposing || event.defaultPrevented) return;
      const modal =
        themePickerOpen ||
        filePickerOpen ||
        commandsOpen ||
        helpOpen ||
        rangeOpen ||
        branchPickerOpen;
      if (
        event.key === "?" &&
        !editing &&
        !modal &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && !editing && !modal) {
        const key = event.code || `Key${event.key.toUpperCase()}`;
        if (["KeyW", "KeyO", "KeyP", "KeyB", "KeyR"].includes(key)) {
          event.preventDefault();
          if (event.repeat) return;
          if (key === "KeyW") {
            if (event.shiftKey) fileWorkspace.closeAll();
            else if (activeFile) fileWorkspace.close(activeFile.id);
          } else if (key === "KeyO" && event.shiftKey) fileWorkspace.closeOthers();
          else if (key === "KeyP" && activeFile) fileWorkspace.pin(activeFile.id);
          else if (key === "KeyB" && activeFile && fileState.file?.kind === "text")
            setBlameEnabled((value) => !value);
          else if (key === "KeyR" && browseSource) resumeFilePicker();
          return;
        }
      }
      if (event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        if (event.shiftKey && !browseSource) return;
        event.preventDefault();
        if (event.repeat) return;
        if (event.shiftKey) toggleFilesSidebar();
        else toggleReviewSidebar();
        return;
      }
      if (themePickerOpen || filePickerOpen || helpOpen || rangeOpen) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        browseSource
      ) {
        event.preventDefault();
        setCommandsOpen(false);
        openContentSearch();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (event.shiftKey && !browseSource) return;
        event.preventDefault();
        if (event.repeat) return;
        if (event.shiftKey) {
          setCommandsOpen(false);
          openFilePicker();
        } else setCommandsOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (fileState.active !== "changes") return;
        event.preventDefault();
        openFind();
        return;
      }
      if (
        editing ||
        commandsOpen ||
        fileState.active !== "changes" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        openFind();
      } else if (event.key === "]") {
        event.preventDefault();
        navigateHunk(1);
      } else if (event.key === "[") {
        event.preventDefault();
        navigateHunk(-1);
      } else if (event.key === "n" && find) {
        event.preventDefault();
        jumpHit(findIndex + 1);
      } else if (event.key === "N" && find) {
        event.preventDefault();
        jumpHit(findIndex - 1);
      } else if (event.key === "c") startNote();
      else if (event.key === "Escape") {
        setFindOpen(false);
        setDraft(null);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    branchPickerOpen,
    themePickerOpen,
    filePickerOpen,
    fileState.active,
    commandsOpen,
    openFind,
    navigateHunk,
    find,
    findIndex,
    jumpHit,
    startNote,
    toggleReviewSidebar,
    toggleFilesSidebar,
    browseSource,
    openFilePicker,
    openContentSearch,
    resumeFilePicker,
    helpOpen,
    rangeOpen,
    activeFile,
    fileState.file?.kind,
    fileWorkspace,
  ]);

  const gitAvailable = state.session?.repository.git !== false;
  const workingAvailable = gitAvailable && !state.historyRef;
  const openWorkingFile = (path: string, pinned = true) => fileWorkspace.open(path, pinned);
  const openVersion = (path: string, side: "old" | "new") => {
    const review = state.review;
    if (!review) return;
    const file = state.files.find((item) => item.path === path);
    const oid = side === "old" ? review.base : review.head;
    const name = side === "old" ? (file?.info.previousPath ?? path) : path;
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid))
      fileWorkspace.open(
        name,
        true,
        undefined,
        { kind: "commit", repo: review.repo, oid },
        `${side === "old" ? "Before" : "After"} · ${oid.slice(0, 7)}`,
      );
  };
  const activeSourceMatches =
    activeFile &&
    activeFile.source.repo === state.review?.repo &&
    (activeFile.source.kind === "worktree" ||
      activeFile.source.oid === state.review.base ||
      activeFile.source.oid === state.review.head);
  const activeDiffFile = activeSourceMatches
    ? state.files.find(
        (file) => file.path === activeFile?.path || file.info.previousPath === activeFile?.path,
      )
    : undefined;
  const commands: ReviewCommand[] = [
    {
      id: "open-branch",
      label: "Open branch or worktree",
      disabled: !gitAvailable,
      run: () => setBranchPickerOpen(true),
    },
    {
      id: "wrap",
      label: wrap ? "Disable line wrapping in diffs" : "Wrap lines in diffs",
      run: () => setWrap((value) => !value),
    },
    {
      id: "show-notes",
      label: showNotes ? "Hide review notes" : "Show review notes",
      run: () => setShowNotes((value) => !value),
    },
    {
      id: "refresh-file",
      label: "Refresh current file",
      disabled: !activeFile,
      run: () => void fileWorkspace.refresh(),
    },
    {
      id: "file-before",
      label: "Open before version of current file",
      disabled:
        !activeDiffFile || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.base ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "old"),
    },
    {
      id: "file-after",
      label: "Open after version of current file",
      disabled:
        !activeDiffFile || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.head ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "new"),
    },
    {
      id: "next-match",
      label: "Next diff search match",
      shortcut: "N",
      disabled: !find || !!activeFile,
      run: () => jumpHit(findIndex + 1),
    },
    {
      id: "previous-match",
      label: "Previous diff search match",
      shortcut: "⇧ N",
      disabled: !find || !!activeFile,
      run: () => jumpHit(findIndex - 1),
    },
    {
      id: "commands",
      label: "Open command palette",
      shortcut: "⌘ K",
      run: () => setCommandsOpen(true),
    },
    {
      id: "help",
      label: "Show all shortcuts and commands",
      shortcut: "?",
      run: () => setHelpOpen(true),
    },
    {
      id: "close-file",
      label: "Close current file",
      shortcut: "⌥ W",
      disabled: !activeFile,
      run: () => activeFile && fileWorkspace.close(activeFile.id),
    },
    {
      id: "close-files",
      label: "Close all files in this workspace",
      shortcut: "⌥ ⇧ W",
      disabled: !fileState.tabs.length,
      run: fileWorkspace.closeAll,
    },
    {
      id: "close-others",
      label: "Close other files in this workspace",
      shortcut: "⌥ ⇧ O",
      disabled: !activeFile || fileState.tabs.length < 2,
      run: fileWorkspace.closeOthers,
    },
    {
      id: "pin-file",
      label: "Keep current preview tab open",
      shortcut: "⌥ P",
      disabled: !activeFile || activeFile.pinned,
      run: () => activeFile && fileWorkspace.pin(activeFile.id),
    },
    { id: "changes", label: "Return to Changes", run: () => fileWorkspace.select("changes") },
    {
      id: "blame",
      label: blameEnabled ? "Hide Git blame" : "Show Git blame for selected lines",
      shortcut: "⌥ B",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => setBlameEnabled((value) => !value),
    },
    {
      id: "content-search",
      label: "Search workspace file contents",
      shortcut: "⌘ ⇧ F",
      disabled: !browseSource,
      run: openContentSearch,
    },
    {
      id: "resume-picker",
      label: "Resume last file search",
      shortcut: "⌥ R",
      disabled: !browseSource,
      run: resumeFilePicker,
    },
    ...(browseSource
      ? [
          {
            id: "open-file",
            label: "Find file in this workspace",
            shortcut: "⌘⇧K",
            run: openFilePicker,
          },
          {
            id: "browse-files",
            label: filesVisible ? "Hide files sidebar" : "Show files sidebar",
            shortcut: "⌘⇧B",
            run: toggleFilesSidebar,
          },
          ...(selectedFile
            ? [
                {
                  id: "open-working-file",
                  label: "Open working file",
                  run: () => openWorkingFile(selectedFile.path),
                },
              ]
            : []),
        ]
      : []),
    { id: "next-file", label: "Go to next changed file", shortcut: "", run: () => navigateFile(1) },
    { id: "previous-file", label: "Go to previous changed file", run: () => navigateFile(-1) },
    { id: "next-hunk", label: "Go to next hunk", shortcut: "]", run: () => navigateHunk(1) },
    {
      id: "previous-hunk",
      label: "Go to previous hunk",
      shortcut: "[",
      run: () => navigateHunk(-1),
    },
    {
      id: "find",
      label: "Find in diff contents",
      shortcut: "⌘ F",
      run: () => {
        fileWorkspace.select("changes");
        openFind();
      },
    },
    {
      id: "filter",
      label: "Filter changed files",
      run: () => {
        setSidebarVisible(true);
        requestAnimationFrame(() => filterRef.current?.focus());
      },
    },
    {
      id: "layout",
      label: `Use ${mode === "split" ? "unified" : "split"} diff layout`,
      run: () => setMode(mode === "split" ? "unified" : "split"),
    },
    {
      id: "theme",
      label: "Change color theme",
      run: () => setThemePickerOpen(true),
    },
    {
      id: "refresh",
      label: "Refresh current review and history",
      run: () => void controller.refresh(),
    },
    ...(gitAvailable
      ? [
          ...(workingAvailable
            ? [
                {
                  id: "working",
                  label: "Review working changes",
                  run: () => void controller.selectComparison({ kind: "working" as const }),
                },
              ]
            : []),
          { id: "range", label: "Compare branches or revisions", run: () => setRangeOpen(true) },
        ]
      : []),
    {
      id: "sidebar",
      label: sidebarVisible ? "Hide sidebar" : "Show sidebar",
      shortcut: "⌘ B",
      run: toggleReviewSidebar,
    },
    { id: "note", label: "Add note to selected lines", shortcut: "C", run: startNote },
  ];
  const comparisonValue = state.comparison.kind;
  const comparisonChoices = [
    ...(workingAvailable
      ? [
          { value: "working", label: "Working changes" },
          { value: "staged", label: "Staged changes" },
          { value: "unstaged", label: "Unstaged changes" },
        ]
      : []),
    ...(!["working", "staged", "unstaged"].includes(comparisonValue)
      ? [
          {
            value: comparisonValue,
            label:
              state.comparison.kind === "commit"
                ? state.comparison.commit.slice(0, 7)
                : state.comparison.kind === "patch"
                  ? "Patch review"
                  : state.comparison.kind === "files"
                    ? "File comparison"
                    : "Revision range",
          },
        ]
      : []),
  ];
  const added = state.review?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0;
  const deleted = state.review?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0;
  const skipped = files.filter((file) => !file.metadata);
  const orphaned = notes.filter(
    (note) =>
      !note.parentId &&
      (note.resolution === "orphaned" ||
        note.resolution === "stale" ||
        !files.some((file) => file.path === note.path && file.metadata)),
  );
  const loadedCommit =
    state.review?.comparison.kind === "commit" ? state.review.comparison.commit : "";

  const renderMetadataRows = () => (
    <div {...stylex.props(styles.skipped)}>
      {skipped.map((file) => (
        <div
          key={file.id}
          {...stylex.props(styles.skippedRow)}
          data-metadata-file={file.path}
          ref={(node) => {
            if (node) metadataRows.current.set(file.id, node);
            else metadataRows.current.delete(file.id);
          }}
        >
          <Icon name="file" size={13} />
          <span>{file.path}</span>
          <span {...stylex.props(ui.grow)} />
          <span {...stylex.props(ui.muted)}>
            {file.info.binary
              ? "Binary file"
              : file.info.tooLarge
                ? "File exceeds preview limit"
                : "Metadata-only change"}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div
      {...stylex.props(styles.app)}
      data-theme={activeTheme.id}
      data-sidebar-visible={sidebarVisible}
      data-selected-branch={state.activeBranch ?? ""}
      data-selected-commit={loadedCommit}
      data-review-id={state.review?.id ?? ""}
      data-review-status={state.status}
      data-file-count={state.files.length}
      data-active-file={activeFile?.path ?? ""}
    >
      {gitAvailable && (
        <BranchTabs
          branches={state.branches}
          worktrees={state.session?.worktrees ?? []}
          activeBranch={state.activeBranch}
          repo={state.session?.repository.path}
          error={state.branchesError}
          onBranch={(name) => void controller.selectBranch(name)}
          onWorktree={(path) => void controller.selectWorktree(path)}
          pickerOpen={branchPickerOpen}
          onPickerOpenChange={setBranchPickerOpen}
        />
      )}
      <ThemePicker open={themePickerOpen} onOpenChange={setThemePickerOpen} />
      <FilePicker
        open={filePickerOpen && !!browseSource}
        onOpenChange={setFilePickerOpen}
        entries={repositoryFiles.entries}
        loading={repositoryFiles.loading}
        error={repositoryFiles.error}
        sourceLabel={sourceLabel}
        source={browseSource}
        api={browseApi}
        sourceRevision={state.sourceRevision}
        openPaths={fileState.tabs
          .filter((tab) => browseSource && sourceKey(tab.source) === sourceKey(browseSource))
          .map((tab) => tab.path)}
        recentPaths={fileState.recentPaths}
        initialMode={pickerMode}
        resume={pickerResume}
        onOpen={(path, line, source) =>
          fileWorkspace.open(
            path,
            false,
            line,
            source,
            source?.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
          )
        }
      />
      <div
        {...stylex.props(styles.workspace)}
        id="review-workspace"
        role="tabpanel"
        aria-label={`${state.activeBranch ?? "Workspace"} review`}
      >
        {sidebarVisible && (
          <aside
            id="review-sidebar"
            className={stylex.props(styles.sidebar).className}
            style={{ width: sidebarWidth }}
          >
            {gitAvailable && (
              <HistoryPanel
                commits={state.history}
                selected={state.comparison.kind === "commit" ? state.comparison.commit : undefined}
                working={state.comparison.kind === "working"}
                workingAvailable={workingAvailable}
                loading={state.historyLoading}
                hasMore={state.historyHasMore}
                error={state.historyError}
                onSelect={(commit) => {
                  fileWorkspace.select("changes");
                  void controller.selectComparison({ kind: "commit", commit });
                }}
                onLoadMore={() => void controller.loadMoreHistory()}
                onWorking={() => {
                  fileWorkspace.select("changes");
                  void controller.selectComparison({ kind: "working" });
                }}
              />
            )}
            <FileSidebar
              files={files}
              total={state.files.length}
              selected={state.selectedFileId}
              filter={state.filter}
              onFilter={(value) => controller.setFilter(value)}
              onSelect={reveal}
              onOpen={
                browseSource
                  ? (id) => {
                      const file = files.find((item) => item.id === id);
                      if (file) openWorkingFile(file.path);
                    }
                  : undefined
              }
              filterRef={filterRef}
            />
          </aside>
        )}
        {sidebarVisible && (
          <div
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={220}
            aria-valuemax={520}
            tabIndex={0}
            {...stylex.props(styles.divider)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setSidebarWidth((width) =>
                  Math.max(220, Math.min(520, width + (event.key === "ArrowLeft" ? -16 : 16))),
                );
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                setSidebarWidth(Math.max(220, Math.min(520, event.clientX)));
            }}
          />
        )}
        <main {...stylex.props(styles.main)} aria-label="Continuous review">
          {!!browseSource && (
            <FileViewTabs
              tabs={fileState.tabs}
              active={fileState.active}
              onSelect={fileWorkspace.select}
              onClose={fileWorkspace.close}
              onPin={fileWorkspace.pin}
            />
          )}
          <div
            id="file-view-panel"
            role="tabpanel"
            aria-label={activeFile ? `File ${activeFile.path}` : "Changes"}
            {...stylex.props(styles.reviewSurface)}
          >
            <div
              {...stylex.props(
                styles.reviewSurface,
                fileState.active !== "changes" && styles.hiddenSurface,
              )}
              aria-hidden={fileState.active !== "changes"}
            >
              <div {...stylex.props(styles.toolbar)}>
                <ChoiceSelect
                  label="Comparison"
                  value={comparisonValue}
                  choices={comparisonChoices}
                  onChange={(value) => {
                    if (["working", "staged", "unstaged"].includes(value))
                      void controller.selectComparison({ kind: value } as Comparison);
                  }}
                />
                <span {...stylex.props(styles.compareLabel)}>
                  {state.review
                    ? `${state.review.base.slice(0, 7)} → ${state.review.head.slice(0, 7)}`
                    : ""}
                </span>
                <span {...stylex.props(ui.grow)} />
                <div {...stylex.props(styles.modeGroup)}>
                  <button
                    {...stylex.props(ui.button, mode === "split" && ui.active)}
                    aria-pressed={mode === "split"}
                    onClick={() => setMode("split")}
                  >
                    <Icon name="split" size={13} />
                    Split
                  </button>
                  <button
                    {...stylex.props(ui.button, mode === "unified" && ui.active)}
                    aria-pressed={mode === "unified"}
                    onClick={() => setMode("unified")}
                  >
                    <Icon name="unified" size={13} />
                    Unified
                  </button>
                </div>
                <button
                  {...stylex.props(ui.button, ui.iconButton, wrap && ui.active)}
                  aria-label="Wrap lines"
                  aria-pressed={wrap}
                  onClick={() => setWrap(!wrap)}
                >
                  <Icon name="wrap" size={14} />
                </button>
                <button
                  {...stylex.props(ui.button, showNotes && ui.active)}
                  aria-label="Toggle notes"
                  aria-pressed={showNotes}
                  onClick={() => setShowNotes(!showNotes)}
                >
                  <Icon name="note" size={13} />
                  {notes.length || ""}
                </button>
                <ActionMenu
                  actions={[
                    ...(selectedFile && browseSource
                      ? [
                          {
                            label:
                              browseSource.kind === "worktree"
                                ? "Open working file"
                                : "Open snapshot file",
                            onClick: () => openWorkingFile(selectedFile.path),
                          },
                          { label: "Reveal in Files", onClick: showFiles },
                        ]
                      : []),
                    { label: "Find in diffs", shortcut: "⌘ F", onClick: openFind },
                    ...(gitAvailable
                      ? [{ label: "Compare revisions…", onClick: () => setRangeOpen(!rangeOpen) }]
                      : []),
                    {
                      label: "Show review notes",
                      checked: showNotes,
                      onClick: () => setShowNotes(!showNotes),
                    },
                    { label: "Wrap long lines", checked: wrap, onClick: () => setWrap(!wrap) },
                    { label: "Refresh review", onClick: () => void controller.refresh() },
                  ]}
                />
                <button
                  {...stylex.props(ui.button, ui.iconButton)}
                  aria-label="Refresh review"
                  disabled={state.status === "loading"}
                  onClick={() => void controller.refresh()}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>
              {rangeOpen && (
                <form
                  {...stylex.props(styles.findbar)}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (baseRef && headRef) {
                      void controller.selectComparison({
                        kind: "range",
                        base: baseRef,
                        head: headRef,
                      });
                      setRangeOpen(false);
                    }
                  }}
                >
                  <span>Compare</span>
                  <input
                    aria-label="Base revision"
                    value={baseRef}
                    onChange={(event) => setBaseRef(event.target.value)}
                    {...stylex.props(ui.input)}
                  />
                  <span>→</span>
                  <input
                    aria-label="Head revision"
                    value={headRef}
                    onChange={(event) => setHeadRef(event.target.value)}
                    {...stylex.props(ui.input)}
                  />
                  <button type="submit" {...stylex.props(ui.button, ui.primary)}>
                    Review
                  </button>
                  <button
                    type="button"
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Close revision comparison"
                    onClick={() => setRangeOpen(false)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </form>
              )}
              {findOpen && (
                <div {...stylex.props(styles.findbar)}>
                  <Icon name="search" size={14} />
                  <input
                    ref={findRef}
                    value={find}
                    onChange={(event) => {
                      setFind(event.target.value);
                      setFindIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        jumpHit(event.shiftKey ? findIndex - 1 : findIndex);
                      }
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setFindOpen(false);
                      }
                    }}
                    aria-label="Find in diff contents"
                    placeholder="Find in changed hunks…"
                    {...stylex.props(ui.input)}
                  />
                  <span {...stylex.props(styles.findCount)}>
                    {find
                      ? hits.length
                        ? `${Math.min(findIndex + 1, hits.length)} / ${hits.length} hunks`
                        : "No matches"
                      : ""}
                  </span>
                  <button
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Previous match"
                    disabled={!hits.length}
                    onClick={() => jumpHit(findIndex - 1)}
                  >
                    <Icon name="arrowUp" size={13} />
                  </button>
                  <button
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Next match"
                    disabled={!hits.length}
                    onClick={() => jumpHit(findIndex + 1)}
                  >
                    <Icon name="arrowDown" size={13} />
                  </button>
                  <button
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Close find"
                    onClick={() => setFindOpen(false)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              )}
              {state.status === "loading" && (
                <div role="status" {...stylex.props(styles.notice)}>
                  {state.review
                    ? "Loading comparison · previous review remains visible"
                    : "Reading repository changes…"}
                </div>
              )}
              {state.error && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  <span>{state.error}</span>
                  <button {...stylex.props(ui.button)} onClick={() => void controller.refresh()}>
                    Retry
                  </button>
                </div>
              )}
              {state.notesError && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  Notes: {state.notesError}
                </div>
              )}
              {orphaned.length > 0 && showNotes && (
                <details {...stylex.props(styles.orphanPanel)}>
                  <summary>
                    {orphaned.length} preserved {orphaned.length === 1 ? "note" : "notes"} outside
                    this diff
                  </summary>
                  {orphaned.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      replies={notes.filter((reply) => reply.parentId === note.id)}
                      onMutate={(mutation) => controller.mutateNote(mutation)}
                    />
                  ))}
                </details>
              )}
              {contextError && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  <span>{contextError}</span>
                  <button {...stylex.props(ui.button)} onClick={() => setContextError(null)}>
                    Dismiss
                  </button>
                </div>
              )}
              {state.review?.warnings.map((warning) => (
                <div key={warning} {...stylex.props(styles.notice)}>
                  {warning}
                </div>
              ))}
              {selection && (
                <div {...stylex.props(styles.selectionbar)}>
                  <span {...stylex.props(ui.mono)}>
                    L{selection.range.start}
                    {selection.range.end !== selection.range.start
                      ? `–${selection.range.end}`
                      : ""}{" "}
                    selected
                  </span>
                  <button {...stylex.props(ui.button, ui.strong)} onClick={startNote}>
                    <Icon name="note" size={12} />
                    Add note
                  </button>
                  <span {...stylex.props(ui.grow)} />
                  <button
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Clear line selection"
                    onClick={() => setSelection(null)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )}
              {items.length > 0 ? (
                <CodeView
                  ref={viewer}
                  onScroll={(position) => {
                    if (fileState.active === "changes") reviewScroll.current = position;
                  }}
                  items={items}
                  selectedLines={selection}
                  onSelectedLinesChange={setSelection}
                  options={options}
                  className={stylex.props(styles.codeView).className}
                  style={
                    {
                      "--diffs-font-family": tokens.code,
                      "--diffs-font-size": "12px",
                      "--diffs-line-height": "20px",
                      "--diffs-header-font-family": tokens.ui,
                      "--diffs-bg-context-override": tokens.canvas,
                      "--diffs-bg-context-gutter-override": tokens.canvas,
                      "--diffs-bg-separator-override": tokens.raised,
                      "--diffs-bg-buffer-override": tokens.panel,
                      "--diffs-addition-color-override": tokens.green,
                      "--diffs-deletion-color-override": tokens.red,
                    } as CSSProperties
                  }
                  renderHeaderPrefix={(item) => (
                    <button
                      {...stylex.props(ui.button, ui.iconButton)}
                      aria-label={`${collapsed.has(item.id) ? "Expand" : "Collapse"} ${item.type === "diff" ? item.fileDiff.name : item.file.name}`}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    >
                      <Icon
                        name="chevron"
                        size={12}
                        style={{ transform: collapsed.has(item.id) ? "rotate(-90deg)" : undefined }}
                      />
                    </button>
                  )}
                  renderAnnotation={(annotation) =>
                    annotation.metadata?.draft ? (
                      <NoteComposer
                        target={annotation.metadata.draft}
                        onSave={(note) => controller.mutateNote({ type: "add", note })}
                        onCancel={() => setDraft(null)}
                      />
                    ) : annotation.metadata?.note ? (
                      <NoteCard
                        note={annotation.metadata.note}
                        replies={notes.filter(
                          (note) => note.parentId === annotation.metadata?.note?.id,
                        )}
                        onMutate={(mutation) => controller.mutateNote(mutation)}
                      />
                    ) : null
                  }
                  renderGutterUtility={(getHoveredLine, item) => (
                    <GutterNoteButton
                      onClick={() => {
                        const line = getHoveredLine();
                        if (line && item.type === "diff") {
                          setShowNotes(true);
                          setDraft({
                            path: item.fileDiff.name,
                            side: "side" in line && line.side === "deletions" ? "old" : "new",
                            line: line.lineNumber,
                          });
                        }
                      }}
                    />
                  )}
                  renderCodeViewFooter={() =>
                    skipped.length ? (
                      renderMetadataRows()
                    ) : (
                      <div {...stylex.props(styles.streamEnd)}>
                        End of review · {files.length} files
                      </div>
                    )
                  }
                />
              ) : state.status !== "loading" && !state.error ? (
                <div {...stylex.props(styles.emptyState)}>
                  <Icon name={skipped.length ? "file" : "check"} size={30} />
                  <h1 {...stylex.props(styles.emptyTitle)}>
                    {state.filter
                      ? "No matching diffs"
                      : skipped.length
                        ? "No text diff to display"
                        : "All caught up"}
                  </h1>
                  {skipped.length ? (
                    renderMetadataRows()
                  ) : (
                    <p {...stylex.props(styles.emptyDescription)}>
                      {state.comparison.kind === "working"
                        ? "Your working tree is clean. Select a commit from history to review its changes."
                        : "This comparison contains no changed text files."}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            {activeFile && (
              <FullFileView
                file={fileState.file}
                loading={fileState.loading}
                error={fileState.error}
                stale={fileState.stale}
                loadBlame={loadBlame}
                blameEnabled={blameEnabled}
                onBlameEnabledChange={setBlameEnabled}
                sourceLabel={activeFile.sourceLabel}
                line={activeFile.line}
                onRefresh={() => void fileWorkspace.refresh()}
                onClose={() => fileWorkspace.close(activeFile.id)}
                onOpenBefore={
                  activeDiffFile && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.base ?? "")
                    ? () => openVersion(activeDiffFile.path, "old")
                    : undefined
                }
                onOpenAfter={
                  activeDiffFile && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.head ?? "")
                    ? () => openVersion(activeDiffFile.path, "new")
                    : undefined
                }
              />
            )}
          </div>
        </main>
        {filesVisible && browseSource && (
          <aside {...stylex.props(styles.filesSidebar)} aria-label="Workspace files">
            <RepositoryFiles
              {...repositoryFiles}
              sourceLabel={sourceLabel}
              selectedPath={activeFile?.path ?? selectedFile?.path ?? null}
              onPreview={(path) => openWorkingFile(path, false)}
              onPin={(path) => openWorkingFile(path, true)}
              onIgnoredChange={repositoryFiles.setIgnored}
              onRefresh={repositoryFiles.refresh}
              onClose={() => setFilesVisible(false)}
            />
          </aside>
        )}
      </div>
      <footer {...stylex.props(styles.statusbar)}>
        <span {...stylex.props(styles.statusDot)} />
        <span>
          {activeFile
            ? "Read-only file"
            : state.comparison.kind === "patch"
              ? "Patch review"
              : state.comparison.kind === "files"
                ? "File comparison"
                : state.comparison.kind === "commit" || state.comparison.kind === "range"
                  ? "Commit review"
                  : state.connection === "connected"
                    ? "Live review"
                    : state.connection === "reconnecting"
                      ? "Reconnecting…"
                      : "Connecting…"}
        </span>
        {activeFile ? (
          <span>
            {fileState.file
              ? `${fileState.file.size.toLocaleString()} bytes`
              : activeFile.sourceLabel}
          </span>
        ) : (
          <>
            <span>{state.files.length} files</span>
            <span {...stylex.props(ui.added)}>+{added}</span>
            <span {...stylex.props(ui.removed)}>−{deleted}</span>
          </>
        )}
        <span {...stylex.props(ui.grow)} />
        <span {...stylex.props(styles.selectedPath)}>{activeFile?.path ?? selectedFile?.path}</span>
        {!activeFile && state.metrics && (
          <span
            title="Request includes transfer; parse runs in a worker; frame measures React update to a frame after Pierre rendered."
            {...stylex.props(styles.performance)}
          >
            {Math.round(state.metrics.requestMs)} ms request · {Math.round(state.metrics.parseMs)}{" "}
            ms parse{frameMs !== null ? ` · ${Math.round(frameMs)} ms frame` : ""} ·{" "}
            {state.metrics.cacheHit
              ? "client cache"
              : state.review?.metrics.cacheHit
                ? "server cache"
                : "fresh"}
          </span>
        )}
        <button
          {...stylex.props(ui.button, styles.helpButton)}
          onClick={() => setHelpOpen(true)}
          title="Shortcuts and commands (?)"
          aria-label="Shortcuts and commands"
        >
          <kbd>?</kbd>
        </button>
      </footer>
      <CommandDialog open={commandsOpen} onOpenChange={setCommandsOpen} commands={commands} />
      <CommandDialog
        title="Shortcuts & commands"
        searchLabel="Search shortcuts and commands"
        open={helpOpen}
        onOpenChange={setHelpOpen}
        commands={commands}
      />
    </div>
  );
}

const styles = stylex.create({
  app: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: tokens.text,
    backgroundColor: tokens.canvas,
    fontFamily: tokens.ui,
    fontSize: 12,
    isolation: "isolate",
  },
  helpButton: { fontSize: 10, minHeight: 20, paddingInline: 7, paddingBlock: 0 },
  workspace: { display: "flex", flex: "1", minHeight: 0 },
  reviewSurface: { display: "flex", flexDirection: "column", flex: "1", minHeight: 0, minWidth: 0 },
  hiddenSurface: { display: "none" },
  filesSidebar: {
    width: 280,
    maxWidth: "42vw",
    minWidth: 200,
    flexShrink: 0,
    display: "flex",
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: tokens.border,
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: tokens.panel,
    minWidth: 180,
    maxWidth: "45vw",
  },
  divider: {
    width: 1,
    minWidth: 1,
    backgroundColor: tokens.border,
    cursor: "col-resize",
    zIndex: 2,
    paddingInline: 2,
    marginInline: -2,
    backgroundClip: "content-box",
    outline: { default: "none", ":focus-visible": `1px solid ${tokens.accent}` },
    touchAction: "none",
  },
  main: { minWidth: 0, flex: "1", display: "flex", flexDirection: "column", overflow: "hidden" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minHeight: 43,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  compareLabel: {
    color: tokens.faint,
    fontSize: 10,
    fontFamily: tokens.code,
    whiteSpace: "nowrap",
    display: { default: "inline", "@media (max-width: 1000px)": "none" },
  },
  modeGroup: { display: "flex", backgroundColor: tokens.panel, padding: 2, borderRadius: 5 },
  findbar: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minHeight: 39,
    paddingInline: 13,
    paddingBlock: 4,
    color: tokens.muted,
    backgroundColor: tokens.panel,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  findCount: { whiteSpace: "nowrap", fontSize: 10, minWidth: 70 },
  notice: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 14,
    minHeight: 30,
    fontSize: 11,
    color: tokens.warning,
    backgroundColor: tokens.panel,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  error: { color: tokens.red },
  orphanPanel: {
    padding: 10,
    color: tokens.warning,
    backgroundColor: tokens.panel,
    fontSize: 11,
    maxHeight: 260,
    overflowY: "auto",
  },
  selectionbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingInline: 12,
    height: 30,
    minHeight: 30,
    backgroundColor: tokens.selected,
    color: tokens.accent,
    fontSize: 11,
  },
  codeView: { flex: "1", minHeight: 0, height: "100%", overflow: "auto", scrollbarWidth: "thin" },
  skipped: { padding: 14, backgroundColor: tokens.panel },
  skippedRow: { display: "flex", alignItems: "center", gap: 8, paddingBlock: 10, fontSize: 12 },
  streamEnd: { padding: 24, textAlign: "center", color: tokens.faint, fontSize: 11 },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: "1",
    minHeight: 180,
    color: tokens.faint,
    padding: 30,
  },
  emptyTitle: { fontSize: 17, fontWeight: 500, color: tokens.text, marginTop: 16, marginBottom: 0 },
  emptyDescription: {
    fontSize: 12,
    lineHeight: 1.8,
    color: tokens.muted,
    maxWidth: 370,
    textAlign: "center",
    whiteSpace: "pre-wrap",
  },
  statusbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingInline: 12,
    height: 27,
    minHeight: 27,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    backgroundColor: tokens.panel,
    color: tokens.muted,
    fontSize: 10,
  },
  statusDot: { width: 5, height: 5, borderRadius: "50%", backgroundColor: tokens.green },
  selectedPath: {
    maxWidth: 230,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    display: { default: "inline", "@media (max-width: 1000px)": "none" },
  },
  performance: { color: tokens.faint, fontFamily: tokens.code, fontSize: 9, whiteSpace: "nowrap" },
});

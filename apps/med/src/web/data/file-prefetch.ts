import type { BrowseRead, BrowseSource } from "../../shared/browse";
import { browseSourceKey, type BrowseApi } from "./browse";
import { getFiletypeFromFileName, resolveLanguages, type FileContents } from "@pierre/diffs";

/** Use exactly the same identity for speculative and visible highlighting. */
export function pierreFile(file: BrowseRead): FileContents {
  return {
    name: file.path,
    contents: file.text ?? "",
    cacheKey: `${JSON.stringify(file.source)}:${file.identity}:${file.plain ? "plain" : "syntax"}`,
    ...(file.plain ? { lang: "text" as const } : {}),
  };
}

/** One-use hover cache: normal reads and explicit refreshes stay fresh. */
export function createFilePrefetch(api: BrowseApi, warm?: (file: FileContents) => Promise<void>) {
  type Entry = {
    promise: Promise<BrowseRead>;
    abort: AbortController;
    expires: number;
    bytes: number;
    source: BrowseSource;
  };
  const entries = new Map<string, Entry>();
  let active = 0;
  let disposed = false;
  const keyFor = (source: BrowseSource, path: string) =>
    JSON.stringify([browseSourceKey(source), path]);
  const prune = () => {
    for (const [key, entry] of entries) if (entry.expires < Date.now()) entries.delete(key);
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (entries.size > 8 || bytes > 4 * 1024 * 1024) {
      const [key, entry] = entries.entries().next().value!;
      bytes -= entry.bytes;
      entries.delete(key);
    }
  };
  return {
    api: {
      ...api,
      async read(source: BrowseSource, path: string, signal?: AbortSignal) {
        // Resolve the language descriptor while I/O is in flight. Otherwise
        // the pool's async metadata lookup lets React mount before dispatch.
        if (warm) void resolveLanguages([getFiletypeFromFileName(path)]).catch(() => {});
        prune();
        const key = keyFor(source, path);
        const entry = entries.get(key);
        entries.delete(key);
        signal?.throwIfAborted();
        const file = await (entry?.promise ?? api.read(source, path, signal));
        signal?.throwIfAborted();
        // Start the real render task before React mounts the viewer. Pierre
        // joins this task when the visible file requests the same identity.
        if (
          !disposed &&
          file.kind === "text" &&
          !file.plain &&
          (file.text?.length ?? 0) <= 256 * 1024
        )
          void warm?.(pierreFile(file)).catch(() => {});
        return file;
      },
    } satisfies BrowseApi,
    prefetch(source: BrowseSource, path: string, warm?: (file: FileContents) => Promise<void>) {
      prune();
      const key = keyFor(source, path);
      if (disposed || entries.has(key) || active >= 2) return;
      active++;
      const abort = new AbortController();
      const entry: Entry = {
        source,
        abort,
        bytes: 0,
        expires: Date.now() + 5000,
        promise: api.read(source, path, abort.signal),
      };
      entries.set(key, entry);
      void entry.promise
        .then(async (file) => {
          if (disposed || abort.signal.aborted) return;
          entry.bytes = 2 * (file.text?.length ?? 0) + 512;
          if (entry.bytes > 2 * 1024 * 1024 && entries.get(key) === entry) entries.delete(key);
          prune();
          // Do not queue large files, plain-text fallbacks, or binary content for highlighting.
          if (file.kind === "text" && !file.plain && entry.bytes <= 512 * 1024)
            await warm?.(pierreFile(file));
        })
        .catch(() => {
          if (entries.get(key) === entry) entries.delete(key);
        })
        .finally(() => active--);
    },
    invalidate() {
      for (const [key, entry] of entries) {
        if (entry.source.kind !== "worktree") continue;
        entries.delete(key);
        entry.abort.abort();
      }
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) entry.abort.abort();
      entries.clear();
    },
  };
}

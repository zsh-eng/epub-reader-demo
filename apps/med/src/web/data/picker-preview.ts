import { useEffect, useState } from "react";
import type { BrowseRead, BrowseSource } from "../../shared/browse";
import { browseSourceKey, type BrowseApi } from "./browse";

/** Retain one response only. A new selection removes old bytes immediately. */
export function usePickerPreview(
  api: BrowseApi | undefined,
  source: BrowseSource | null | undefined,
  path: string | undefined,
  revision: number | string,
) {
  const scope = source ? browseSourceKey(source) : "";
  const key = JSON.stringify([scope, path, revision]);
  const [state, setState] = useState<{
    key: string;
    file: BrowseRead | null;
    error: string | null;
  }>({
    key: "",
    file: null,
    error: null,
  });
  useEffect(() => {
    if (!api || !scope || !path) return;
    const controller = new AbortController();
    const [kind, repo, oid] = JSON.parse(scope) as ["worktree" | "commit", string, string?];
    const requestSource: BrowseSource =
      kind === "commit" ? { kind, repo, oid: oid! } : { kind, repo };
    void api
      .read(requestSource, path, controller.signal)
      .then((file) => {
        if (
          !controller.signal.aborted &&
          browseSourceKey(file.source) === scope &&
          file.path === path
        )
          setState({ key, file, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            file: null,
            error: error instanceof Error ? error.message : "Cannot preview file.",
          });
      });
    return () => controller.abort();
  }, [api, scope, path, revision, key]);
  const current = state.key === key;
  return {
    file: current ? state.file : null,
    error: current ? state.error : null,
    loading: !!api && !!scope && !!path && !current,
  };
}

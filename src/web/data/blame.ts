import type { BrowseRead } from "../../shared/browse";
import { browseBlameResponseSchema, type BrowseBlame } from "../../shared/inspect";
import { createApi } from "./api";
import { browseSourceKey } from "./browse";

export type BlameLoader = (
  file: BrowseRead,
  startLine: number,
  endLine: number,
  signal: AbortSignal,
) => Promise<BrowseBlame>;

export function createBlameLoader(fetcher: typeof fetch, token: string): BlameLoader {
  const api = createApi(fetcher, token);
  return async (file, startLine, endLine, signal) => {
    const result = await api.json("/api/browse/blame", browseBlameResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: file.source,
        path: file.path,
        identity: file.identity,
        startLine,
        endLine,
      }),
      signal,
    });
    if (
      browseSourceKey(result.source) !== browseSourceKey(file.source) ||
      result.path !== file.path ||
      result.identity !== file.identity
    )
      throw new Error("Line history belongs to a different file version. Refresh this file.");
    if (result.lines.some((entry) => entry.line < startLine || entry.line > endLine))
      throw new Error("Line history does not match the selected lines.");
    return result;
  };
}

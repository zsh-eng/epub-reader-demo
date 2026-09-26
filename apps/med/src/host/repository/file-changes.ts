import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "../runtime/process";
import { readBrowse } from "./browse";
import { HostError } from "../runtime/errors";
import type { BrowseSource } from "../../shared/browse";
import type { FileChanges } from "../../shared/file-changes";
import type { ReviewResponse, SourceResponse } from "../../shared/protocol";

/** Mark only the exact displayed bytes, never apply snapshot line numbers to a newer file. */
export async function fileChanges(
  source: BrowseSource,
  path: string,
  identity: string,
  comparison: { review: ReviewResponse; source(path: string): Promise<SourceResponse> } | undefined,
  signal: AbortSignal,
): Promise<FileChanges> {
  const file = await readBrowse(source, path, signal);
  if (file.identity !== identity)
    throw new HostError("file-changed", "Refresh this file to show current change markers.", 409);
  const result: FileChanges = { identity, label: "", ranges: [] };
  if (file.kind !== "text" || file.text === undefined) return result;
  let before: string | undefined,
    after: string | undefined,
    side: "old" | "new" = "new",
    working = false;
  if (comparison) {
    const { review } = comparison;
    if (review.repo !== source.repo)
      throw new HostError("invalid-source", "The comparison belongs to another repository.", 400);
    const entry = review.files.find((entry) => entry.path === path || entry.previousPath === path);
    if (entry && !entry.binary && !entry.tooLarge) {
      const captured = await comparison.source(entry.path);
      if (source.kind === "commit" && source.oid === review.base && file.text === captured.old)
        side = "old";
      else if (file.text !== captured.new) side = "old"; // Does not match the comparison's after side.
      if (
        (side === "old" &&
          source.kind === "commit" &&
          source.oid === review.base &&
          file.text === captured.old) ||
        (side === "new" && file.text === captured.new)
      ) {
        before = captured.old;
        after = captured.new;
        working = ["working", "staged", "unstaged"].includes(review.comparison.kind);
        result.label = review.label;
      }
    }
  }
  if (before === undefined && source.kind === "worktree") {
    const head = (
      await git(source.repo, ["rev-parse", "--verify", "HEAD"], {
        signal,
        acceptedExitCodes: [0, 128],
        maxBytes: 256,
      })
    )
      .toString("utf8")
      .trim();
    const base = head
      ? await readBrowse({ kind: "commit", repo: source.repo, oid: head }, path, signal)
      : null;
    if (base && base.kind !== "text" && base.kind !== "missing") return result;
    before = base?.text ?? "";
    after = file.text;
    side = "new";
    working = true;
    result.label = "Working changes against HEAD";
  }
  if (before === undefined || after === undefined || before === after) return result;
  const directory = await mkdtemp(join(tmpdir(), "med-gutter-"));
  try {
    await Promise.all([
      writeFile(join(directory, "before"), before),
      writeFile(join(directory, "after"), after),
    ]);
    const patch = (
      await git(
        directory,
        [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--unified=0",
          "--",
          "before",
          "after",
        ],
        { signal, acceptedExitCodes: [0, 1], maxBytes: 20 * 1024 * 1024 },
      )
    ).toString("utf8");
    for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const oldStart = Number(match[1]),
        oldCount = Number(match[2] ?? 1);
      const newStart = Number(match[3]),
        newCount = Number(match[4] ?? 1);
      const start = side === "old" ? oldStart : newStart;
      const count = side === "old" ? oldCount : newCount;
      const opposite = side === "old" ? newCount : oldCount;
      if (count)
        result.ranges.push({
          start,
          end: start + count - 1,
          kind: side === "old" ? "deleted" : working ? "working" : "added",
        });
      // Deleted lines have no after-side row: attach a tick at the gap.
      if (opposite && !count)
        result.ranges.push({
          start: Math.max(1, start),
          end: Math.max(1, start),
          kind: side === "old" ? "added" : "deleted",
          edge: start === 0 ? "before" : "after",
        });
    }
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

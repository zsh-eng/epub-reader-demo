import type { GitTargets, PushRequest } from "../../shared/git-actions";
import { git, runProcess, ProcessFailure } from "../runtime/process";
import { HostError } from "../runtime/errors";
import { resolveCommit } from "./history";

export async function gitTargets(repo: string, signal?: AbortSignal): Promise<GitTargets> {
  const [refData, remoteData, branchData, head] = await Promise.all([
    git(repo, ["for-each-ref", "--format=%(refname)%00%(symref)", "refs/heads/", "refs/remotes/"], {
      signal,
      maxBytes: 2 * 1024 * 1024,
    }),
    git(repo, ["remote"], { signal, maxBytes: 64 * 1024 }),
    git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      signal,
      maxBytes: 1024,
      acceptedExitCodes: [0, 1],
    }),
    resolveCommit(repo, "HEAD", signal).catch(() => ""),
  ]);
  const refs = refData
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((row) => {
      const [name, symbolic] = row.split("\0");
      return name && !symbolic
        ? [{ name, label: name.replace(/^refs\/(heads|remotes)\//, "") }]
        : [];
    });
  const remotes = remoteData
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((name) => ({
      name,
      branches: refs
        .filter((ref) => ref.name.startsWith(`refs/remotes/${name}/`))
        .map((ref) => ref.name.slice(`refs/remotes/${name}/`.length)),
    }));
  return { refs, remotes, branch: branchData.toString("utf8").trim(), head };
}

/** Publish only an explicit commit to one named remote branch. Never force, delete or mirror. */
export async function pushBranch(input: PushRequest, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.remote) || input.remote.includes(".."))
    throw new HostError("invalid-remote", "Select a configured remote.");
  if (
    input.branch.startsWith("-") ||
    input.branch.startsWith("refs/") ||
    input.branch.includes("\0")
  )
    throw new HostError("invalid-branch", "Enter a branch name, such as feature/review.");
  try {
    await git(input.repo, ["check-ref-format", `refs/heads/${input.branch}`], {
      signal,
      maxBytes: 1024,
    });
  } catch {
    signal?.throwIfAborted();
    throw new HostError("invalid-branch", "Enter a valid branch name.");
  }
  const targets = await gitTargets(input.repo, signal);
  if (!targets.remotes.some((remote) => remote.name === input.remote))
    throw new HostError("invalid-remote", "This remote is no longer configured. Reopen Push.");
  const urls = (
    await git(input.repo, ["remote", "get-url", "--push", "--all", input.remote], {
      signal,
      maxBytes: 64 * 1024,
    })
  )
    .toString("utf8")
    .trim()
    .split("\n");
  if (urls.length !== 1)
    throw new HostError(
      "multiple-push-destinations",
      "This remote has multiple push destinations. Use a remote with one destination.",
    );
  const head = await resolveCommit(input.repo, input.head, signal);
  try {
    const result = await runProcess(
      "git",
      [
        "-c",
        `remote.${input.remote}.mirror=false`,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "push.followTags=false",
        "push",
        "--porcelain",
        "--no-force",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        input.remote,
        `${head}:refs/heads/${input.branch}`,
      ],
      {
        cwd: input.repo,
        signal,
        maxBytes: 128 * 1024,
        timeoutMs: 120_000,
        acceptedExitCodes: [0, 1],
        env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      },
    );
    if (result.exitCode !== 0)
      throw new ProcessFailure(
        "Push did not complete",
        "command-failed",
        `${result.stdout.toString("utf8")}\n${result.stderr}`,
      );
  } catch (error) {
    signal?.throwIfAborted();
    const rejected =
      error instanceof ProcessFailure &&
      /non-fast-forward|fetch first|\[rejected\]/i.test(error.stderr);
    throw new HostError(
      rejected ? "push-rejected" : "push-failed",
      rejected
        ? "The remote branch has changes that this commit does not contain. Fetch and merge or rebase, or push to a new branch."
        : "Push did not complete. Check remote access and authentication, then check the remote branch before retrying.",
      422,
    );
  }
  return { head, remote: input.remote, branch: input.branch };
}

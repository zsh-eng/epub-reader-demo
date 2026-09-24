import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { savedReviewCreateSchema } from "../shared/saved-review";
import {
  DEFAULT_PORT,
  getStateDirectory,
  readConnection,
  type RunningConnection,
} from "../host/runtime/connection";

export const reviewManifestSchema = savedReviewCreateSchema.strict();
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;

export const reviewHelp = `Usage: med-diff review create --title <title> --repo <path> --base <ref> --head <ref>
       med-diff review create --title <title> --repo <path> --working
       med-diff review create --manifest <json-path>
       med-diff review repos

Options: --port <port> (default ${DEFAULT_PORT}), --state-dir <path> (or MED_STATE_DIR)
The running host must already have the target repositories registered.
--working captures the current changes, including pre-existing changes.
A manifest is {"title":"Review title","targets":[{"repo":"/absolute/path","comparison":{"kind":"range","base":"<ref>","head":"<ref>"}}]}.
The create command prints a Markdown review link without an access token.`;

export interface ReviewCommand {
  kind: "help" | "repos" | "create";
  port: number;
  stateDir: string;
  manifest?: ReviewManifest;
}

export async function parseReviewCommand(args: string[]): Promise<ReviewCommand> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      title: { type: "string" },
      repo: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      working: { type: "boolean" },
      manifest: { type: "string" },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Review connection port must be between 1 and 65535.");
  const common = { port, stateDir: getStateDirectory(values["state-dir"]) };
  if (values.help) return { ...common, kind: "help" };
  if (positionals.length !== 1 || !["repos", "create"].includes(positionals[0]!))
    throw new Error(reviewHelp);
  const targetOptions = [values.title, values.repo, values.base, values.head, values.working];
  if (positionals[0] === "repos") {
    if (values.manifest !== undefined || targetOptions.some((value) => value !== undefined))
      throw new Error("The repos command accepts only --port and --state-dir.");
    return { ...common, kind: "repos" };
  }
  let input: unknown;
  if (values.manifest !== undefined) {
    if (targetOptions.some((value) => value !== undefined))
      throw new Error("Use --manifest without --title, --repo, --base, --head, or --working.");
    try {
      input = JSON.parse(await readFile(resolve(values.manifest), "utf8"));
    } catch {
      throw new Error("Could not read the review manifest. Supply a readable JSON file.");
    }
  } else {
    if (!values.title || !values.repo)
      throw new Error("Use --title and --repo, or supply --manifest.");
    if (values.working && (values.base !== undefined || values.head !== undefined))
      throw new Error("Use --working without --base or --head.");
    if (!values.working && (!values.base || !values.head))
      throw new Error(
        "Supply both --base and --head, or use --working to capture current changes.",
      );
    input = {
      title: values.title,
      targets: [
        {
          repo: values.repo,
          comparison: values.working
            ? { kind: "working" }
            : { kind: "range", base: values.base, head: values.head },
        },
      ],
    };
  }
  const result = reviewManifestSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "Invalid review manifest. Supply a title and 1–16 targets, each with repo and a Git comparison.",
    );
  const manifest = {
    ...result.data,
    targets: result.data.targets.map((target) => ({ ...target, repo: resolve(target.repo) })),
  };
  return { ...common, kind: "create", manifest };
}

async function request(
  connection: RunningConnection,
  path: string,
  fetcher: typeof fetch,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${connection.origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(35_000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      `Could not connect to med at ${connection.origin}. Start med-diff with your repositories and retry.`,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(data);
    const detail = parsed.success
      ? parsed.data.error.message.replaceAll(connection.token, "[credential]")
      : `HTTP ${response.status}`;
    throw new Error(`Med request failed: ${detail}`);
  }
  return data;
}

export async function runReviewCommand(
  args: string[],
  options: { fetcher?: typeof fetch; print?: (text: string) => void } = {},
): Promise<void> {
  const command = await parseReviewCommand(args);
  const print = options.print ?? console.log;
  if (command.kind === "help") {
    print(reviewHelp);
    return;
  }
  const connection = await readConnection(command.stateDir, command.port);
  const fetcher = options.fetcher ?? fetch;
  const repositories = await request(connection, "/api/repositories", fetcher);
  if (command.kind === "repos") {
    print(JSON.stringify(repositories, null, 2));
    return;
  }
  const result = await request(connection, "/api/reviews", fetcher, command.manifest);
  const parsed = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/) }).safeParse(result);
  if (!parsed.success) throw new Error("Med returned an invalid review ID.");
  print(`[Review changes here](${connection.origin}/review/${parsed.data.id})`);
}

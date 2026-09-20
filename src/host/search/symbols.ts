import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import type { SymbolMatch, SymbolSearch, SymbolSearchRequest } from "../../shared/symbols";
import { readBrowse } from "../repository/browse";
import { runProcess } from "../runtime/process";

export interface CtagsTool {
  path: string;
  version: string;
}
export const ctagsSetupMessage =
  "Install Universal Ctags: brew install universal-ctags (macOS), or sudo pacman -S ctags (Omarchy). Set MED_CTAGS_BIN for a custom binary.";
export async function discoverCtags(): Promise<CtagsTool | undefined> {
  for (const path of process.env.MED_CTAGS_BIN
    ? [process.env.MED_CTAGS_BIN]
    : ["/opt/homebrew/bin/ctags", "/usr/local/bin/ctags", "universal-ctags", "ctags"]) {
    try {
      const result = await runProcess(path, ["--options=NONE", "--version"], {
        cwd: tmpdir(),
        timeoutMs: 2000,
        maxBytes: 8192,
      });
      const version = result.stdout.toString("utf8");
      if (!version.startsWith("Universal Ctags")) continue;
      const features = await runProcess(path, ["--options=NONE", "--list-features"], {
        cwd: tmpdir(),
        timeoutMs: 2000,
        maxBytes: 8192,
      });
      if (/\bjson\b/.test(features.stdout.toString("utf8"))) return { path, version };
    } catch {
      /* Do not accept the macOS system ctags or a broken binary. */
    }
  }
}
const tagSchema = z.object({
  _type: z.literal("tag"),
  name: z.string().min(1).max(4096),
  kind: z.string().optional(),
  line: z.number().int().positive().max(200_000),
  scope: z.string().optional(),
});
export function parseSymbols(
  output: string,
  path: string,
): { matches: SymbolMatch[]; truncated: boolean } {
  const matches: SymbolMatch[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const row of output.split("\n")) {
    if (!row) continue;
    let value: unknown;
    try {
      value = JSON.parse(row);
    } catch {
      continue;
    }
    const parsed = tagSchema.safeParse(value);
    if (!parsed.success) continue;
    const tag = parsed.data;
    const key = JSON.stringify([tag.name, tag.line, tag.kind]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (matches.length >= 10_000) {
      truncated = true;
      break;
    }
    matches.push({
      name: tag.name,
      kind: tag.kind ?? "symbol",
      path,
      line: tag.line,
      ...(tag.scope ? { scope: tag.scope } : {}),
    });
  }
  return { matches, truncated };
}

/** Parse a private copy of the exact bounded snapshot. Never let Ctags follow repo options. */
export class FileSymbolService {
  private readonly cache = new Map<
    string,
    { matches: SymbolMatch[]; truncated: boolean; unavailable?: string }
  >();
  private toolPromise?: Promise<CtagsTool | undefined>;
  constructor(private readonly tool?: CtagsTool) {}
  async search(input: SymbolSearchRequest, signal?: AbortSignal): Promise<SymbolSearch> {
    const base: SymbolSearch = {
      source: input.source,
      path: input.path,
      query: input.query,
      engine: "ctags",
      matches: [],
      truncated: false,
    };
    if (!input.path) return { ...base, unavailable: "Select a file to search its symbols." };
    const file = await readBrowse(input.source, input.path, signal);
    base.identity = file.identity;
    if (input.identity && file.identity !== input.identity)
      return { ...base, unavailable: "This file changed. Reopen it before searching its symbols." };
    if (file.kind !== "text" || file.text === undefined)
      return { ...base, unavailable: file.reason ?? "Symbols require a text file." };
    const tool = this.tool ?? (await (this.toolPromise ??= discoverCtags()));
    if (!tool) return { ...base, unavailable: ctagsSetupMessage };
    const key = createHash("sha256")
      .update(tool.version)
      .update(input.path)
      .update(file.text)
      .digest("hex");
    let result = this.cache.get(key);
    if (!result) {
      const directory = await mkdtemp(join(tmpdir(), "med-symbols-"));
      try {
        const path = join(directory, basename(input.path));
        await writeFile(path, file.text, { mode: 0o600 });
        const language = await runProcess(tool.path, ["--options=NONE", "--print-language", path], {
          cwd: directory,
          signal,
          timeoutMs: 5000,
          maxBytes: 8192,
        });
        if (/NONE\s*$/.test(language.stdout.toString("utf8")))
          result = {
            matches: [],
            truncated: false,
            unavailable: "Universal Ctags does not support this file language.",
          };
        else {
          const output = await runProcess(
            tool.path,
            [
              "--options=NONE",
              "--output-format=json",
              "--fields=+nKZ",
              "--sort=no",
              "-f",
              "-",
              path,
            ],
            { cwd: directory, signal, timeoutMs: 10_000, maxBytes: 8 * 1024 * 1024 },
          );
          result = parseSymbols(output.stdout.toString("utf8"), input.path);
        }
        signal?.throwIfAborted();
        this.cache.set(key, result);
        if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    const query = input.query.toLocaleLowerCase();
    return {
      ...base,
      ...result,
      matches: query
        ? result.matches.filter((match) => match.name.toLocaleLowerCase().includes(query))
        : result.matches,
    };
  }
}

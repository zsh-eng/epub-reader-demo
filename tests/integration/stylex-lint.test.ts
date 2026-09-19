import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("Oxlint executes the actual StyleX validation plugin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "med-stylex-"));
  try {
    const config = join(dir, "lint.json");
    await writeFile(
      config,
      JSON.stringify({
        jsPlugins: [
          {
            name: "stylex",
            specifier: resolve("node_modules/@stylexjs/eslint-plugin/lib/index.js"),
          },
        ],
        rules: { "stylex/valid-styles": "error" },
      }),
    );
    const file = join(dir, "fixture.ts");
    await writeFile(
      file,
      "import * as stylex from '@stylexjs/stylex'; export const styles = stylex.create({root:{color:'red'}});",
    );
    await expect(
      run(resolve("node_modules/.bin/oxlint"), ["--config", config, file]),
    ).resolves.toBeDefined();
    await writeFile(
      file,
      "import * as stylex from '@stylexjs/stylex'; export const styles = stylex.create({root:{unknownProperty:2}});",
    );
    const result = await run(resolve("node_modules/.bin/oxlint"), ["--config", config, file]).catch(
      (error) => error,
    );
    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("stylex(valid-styles)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

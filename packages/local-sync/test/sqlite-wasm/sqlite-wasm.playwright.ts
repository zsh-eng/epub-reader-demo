import { expect, test } from "@playwright/test";
import type { SqliteWasmProofResult } from "./main.js";

test("runs the sync storage model in persistent sqlite-wasm", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__sqliteWasmProof.status !== "running",
    undefined,
    { timeout: 30_000 },
  );

  const result = await page.evaluate(() => window.__sqliteWasmProof);
  expect(result).toMatchObject({
    status: "passed",
    storage: "opfs",
    persistedBooks: 3,
    persistedHlcCounter: 2,
    lwwWinners: ["book-2", "book-3"],
  } satisfies Partial<SqliteWasmProofResult>);

  if (result.status === "passed") {
    expect(result.sqliteVersion).toBe("3.53.0");
  }
});

import { expect, test } from "bun:test";
import {
  availableDeckIds,
  createAssetLinkResolver,
  undoImportedCards,
} from "./session";

test("deck validation leaves stored preferences intact during hydration", () => {
  const selected = ["old", "saved"];
  expect(availableDeckIds(selected, [])).toEqual([]);
  expect(selected).toEqual(["old", "saved"]);
  expect(availableDeckIds(selected, [{ id: "saved" }])).toEqual(["saved"]);
});

test("shared assets upload once and keep each reference alternative text", async () => {
  let uploads = 0;
  const resolve = createAssetLinkResolver(async () => {
    uploads++;
    return { success: true, fileKey: "shared-image" };
  });
  const file = () => new File(["image"], "image.png");
  const links = await Promise.all([
    resolve("assets/shared.png", file, "First view"),
    resolve("assets/shared.png", file, "Second view"),
  ]);
  expect(uploads).toBe(1);
  expect(links[0]).toContain("![First view](");
  expect(links[1]).toContain("![Second view](");
  expect(links[0].split("](")[1]).toEqual(links[1].split("](")[1]);
});

test("partial undo retains only failed IDs for the next attempt", async () => {
  const result = await undoImportedCards(["a", "b", "c"], async (id) => {
    if (id === "b") throw new Error("Write failed");
  });
  expect(result).toEqual({ failedIds: ["b"], undone: 2 });
  const retried: string[] = [];
  expect(
    await undoImportedCards(result.failedIds, async (id) => {
      retried.push(id);
    }),
  ).toEqual({ failedIds: [], undone: 1 });
  expect(retried).toEqual(["b"]);
});

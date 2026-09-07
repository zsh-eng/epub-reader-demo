import { expect, test } from "bun:test";
import { deckMatchesSearch } from "./deck-search";

test("deck search preserves punctuation and applies the same case and space rules", () => {
  const deck = { name: "A-B", description: "Vocabulary" };
  expect(deckMatchesSearch(deck, "A-B")).toBe(true);
  expect(deckMatchesSearch(deck, " a-b ")).toBe(true);
  expect(deckMatchesSearch(deck, " VOCABULARY ")).toBe(true);
  expect(deckMatchesSearch(deck, "A-C")).toBe(false);
});

import { expect, test } from "vitest";
import { findVimMatches, VimNavigation } from "../../src/web/data/vim-navigation";
const keys = (model: VimNavigation, text: string) => {
  for (const key of text) model.key(key);
};
test("counted motions retain column through shorter lines and stop at file boundaries", () => {
  const model = new VimNavigation("abcdef\nx\nabcdef\n");
  keys(model, "4ljj");
  expect([model.line, model.column]).toEqual([2, 4]);
  keys(model, "99j99l");
  expect([model.line, model.column]).toEqual([2, 5]);
  keys(model, "gg2G");
  expect(model.line).toBe(1);
  keys(model, "G");
  expect(model.line).toBe(2);
  keys(model, "$kk");
  expect(model.column).toBe(5);
});
test("character motions do not split surrogate pairs or combining characters", () => {
  const model = new VimNavigation("a🙂e\u0301z");
  keys(model, "l");
  expect(model.column).toBe(1);
  keys(model, "l");
  expect(model.column).toBe(3);
  keys(model, "l");
  expect(model.column).toBe(5);
  keys(model, "h");
  expect(model.column).toBe(3);
});
test("word motions distinguish punctuation from keywords and cross lines", () => {
  const model = new VimNavigation("one.two\n  three four");
  keys(model, "w");
  expect(model.column).toBe(3);
  keys(model, "w");
  expect(model.column).toBe(4);
  keys(model, "e");
  expect(model.column).toBe(6);
  keys(model, "w");
  expect([model.line, model.column]).toEqual([1, 2]);
  keys(model, "b");
  expect([model.line, model.column]).toEqual([0, 4]);
});
test("find and till support counts, repeats and reverse repeats", () => {
  const model = new VimNavigation("a x b x c x d");
  keys(model, "2fx");
  expect(model.column).toBe(6);
  keys(model, ";");
  expect(model.column).toBe(10);
  keys(model, ",");
  expect(model.column).toBe(6);
  keys(model, "0tx;");
  expect(model.column).toBe(5);
  keys(model, "T x"); // unknown keys do not alter the text
  expect(model.text).toBe("a x b x c x d");
});
test("paragraphs use empty lines, not whitespace-only lines, and accept counts", () => {
  const model = new VimNavigation("a\n \nb\n\nc\n\nd\n");
  keys(model, "}");
  expect(model.line).toBe(3);
  keys(model, "}");
  expect(model.line).toBe(5);
  keys(model, "2{");
  expect(model.line).toBe(0);
});
test("file search uses literal smart-case and whole keyword boundaries", () => {
  expect(findVimMatches("Foo foo foobar FOO", "foo")).toEqual([0, 4, 8, 15]);
  expect(findVimMatches("Foo foo foobar FOO", "Foo")).toEqual([0]);
  expect(findVimMatches("Foo foo foobar FOO", "foo", true)).toEqual([0, 4, 15]);
  expect(findVimMatches("a.b axb a.b", "a.b")).toEqual([0, 8]);
  const model = new VimNavigation("x aa x aa");
  model.matches = [2, 7];
  model.nextMatch();
  expect(model.column).toBe(2);
  model.nextMatch();
  expect(model.column).toBe(7);
  model.nextMatch();
  expect(model.column).toBe(2);
  model.nextMatch(-1);
  expect(model.column).toBe(7);
});
test("half-page motions and canceled prefixes do not leak pending counts", () => {
  const model = new VimNavigation("a\n".repeat(100));
  model.key("d", true, 20);
  expect(model.line).toBe(20);
  keys(model, "4g");
  model.key("Escape");
  keys(model, "j");
  expect(model.line).toBe(21);
});
test("vertical motions retain screen column across tabs and CRLF paragraphs", () => {
  const model = new VimNavigation("\tx\r\nabc\r\n\r\nz\r\n");
  keys(model, "lj");
  expect(model.column).toBe(2);
  keys(model, "k");
  expect(model.column).toBe(1);
  keys(model, "}");
  expect(model.line).toBe(2);
  keys(model, "}");
  expect(model.line).toBe(3);
});
test("word motions handle non-BMP letters without splitting a character", () => {
  const model = new VimNavigation("𝒜𝒞 next");
  keys(model, "e");
  expect(model.column).toBe(2);
  keys(model, "w");
  expect(model.column).toBe(5);
  keys(model, "b");
  expect(model.column).toBe(0);
});

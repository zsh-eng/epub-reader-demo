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

test("Shift+A moves to the final grapheme without entering edit mode", () => {
  const model = new VimNavigation("a🙂e\u0301\n\nlonger line");
  keys(model, "A");
  expect([model.line, model.column, model.characterLength]).toEqual([0, 3, 2]);
  keys(model, "jA");
  expect([model.line, model.column]).toEqual([1, 0]);
  keys(model, "j0A");
  expect([model.line, model.column]).toEqual([2, 10]);
  expect(model.text).toBe("a🙂e\u0301\n\nlonger line");
});

test("z motions align the current line, retain its column, and accept a line count", () => {
  const model = new VimNavigation("abcdef\nabcdef\nabcdef\n");
  keys(model, "j3l");
  for (const [key, align] of [
    ["z", "center"],
    ["t", "start"],
    ["b", "end"],
  ]) {
    model.key("z");
    expect(model.key(key!)).toEqual({ handled: true, align });
    expect([model.line, model.column]).toEqual([1, 3]);
  }
  keys(model, "3z");
  expect(model.key("t").align).toBe("start");
  expect([model.line, model.column]).toEqual([2, 3]);
  keys(model, "99z");
  model.key("b");
  expect([model.line, model.column]).toEqual([2, 3]);
  keys(model, "2z");
  model.key("Escape");
  keys(model, "k");
  expect(model.line).toBe(1);
});

test("colon opens a line command and line addresses are bounded and validated", () => {
  const model = new VimNavigation("one\ntwo\nthree\n");
  expect(model.key(":")).toEqual({ handled: true, lineCommand: true });
  expect(model.goToLine(" 2 ")).toBe("moved");
  expect([model.line, model.column]).toEqual([1, 0]);
  for (const value of ["0", "-1", "1.5", "1e2", "2x", "w", "9007199254740992"]) {
    expect(model.goToLine(value)).toBe("invalid");
    expect(model.line).toBe(1);
  }
  expect(model.goToLine(" ")).toBe("empty");
  expect(model.line).toBe(1);
  expect(model.goToLine("999")).toBe("moved");
  expect(model.line).toBe(2);
  const colon = new VimNavigation("a:b");
  colon.key("f");
  expect(colon.key(":").lineCommand).toBeUndefined();
  expect(colon.column).toBe(1);
});

test("visual character selections are inclusive, reversible, and grapheme-safe", () => {
  const model = new VimNavigation("a🙂e\u0301\nnext\n");
  keys(model, "lv");
  expect(model.selectedText()).toBe("🙂");
  keys(model, "l");
  expect(model.selectedText()).toBe("🙂e\u0301");
  keys(model, "oh");
  expect(model.selectedText()).toBe("a🙂e\u0301");
  keys(model, "G$");
  expect(model.selectedText()).toBe("e\u0301\nnext");
  expect(model.key("y")).toEqual({ handled: true, copy: true });
  expect(model.visual).not.toBeNull();
  model.key("Escape");
  expect(model.visualRange).toBeNull();
});

test("visual line selections preserve CRLF and a missing final newline", () => {
  const model = new VimNavigation("one\r\n\r\n\tthree");
  keys(model, "Vj");
  expect(model.selectedText()).toBe("one\r\n\r\n");
  keys(model, "G");
  expect(model.selectedText()).toBe(model.text);
  keys(model, "o");
  expect(model.selectedText()).toBe(model.text);
  keys(model, "j");
  expect(model.selectedText()).toBe("\r\n\tthree");
  model.key("Escape");
  keys(model, "GV");
  expect(model.selectedText()).toBe("\tthree");
});

test("visual modes switch without resetting the anchor; repeated mode exits", () => {
  const model = new VimNavigation("abcd\nefgh\n");
  keys(model, "lvjl");
  expect(model.selectedText()).toBe("bcd\nefg");
  keys(model, "V");
  expect(model.selectedText()).toBe(model.text);
  keys(model, "v");
  expect(model.selectedText()).toBe("bcd\nefg");
  keys(model, "v");
  expect(model.visual).toBeNull();
  keys(model, "fV"); // A find target is not a mode switch.
  expect(model.visual).toBeNull();
});

test("visual selections include blank lines and survive paragraph and counted motions", () => {
  const model = new VimNavigation("first\n\nlast\n");
  keys(model, "jv");
  expect(model.selectedText()).toBe("\n");
  keys(model, "k$");
  expect(model.selectedText()).toBe("t\n\n");
  model.key("Escape");
  keys(model, "ggV2}");
  expect(model.selectedText()).toBe(model.text);
  expect(new VimNavigation("").selectedText()).toBe("");
  const empty = new VimNavigation("");
  keys(empty, "v");
  expect(empty.visualRange).toMatchObject({ start: 0, end: 0 });
});

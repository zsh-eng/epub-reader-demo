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

test("gd requests the identifier under the cursor without moving it", () => {
  const model = new VimNavigation("call(target_name);\n");
  model.jump(0, 8);
  model.key("g");
  expect(model.key("d")).toEqual({ handled: true, definition: "target_name" });
  expect(model.column).toBe(8);
  model.jump(0, 4);
  model.key("g");
  expect(model.key("d").definition).toBe("");
});

test("jump-back swaps jump origins while ordinary motions leave them intact", () => {
  const model = new VimNavigation("zero\n  one word\ntwo\nthree\nfour\nfive\n");
  model.jump(1, 6);
  keys(model, "5Gk''");
  expect([model.line, model.column]).toEqual([1, 2]);
  keys(model, "''");
  expect(model.line).toBe(3);
  model.jump(1, 6);
  model.goToLine("6");
  keys(model, "``");
  expect([model.line, model.column]).toEqual([1, 6]);
  keys(model, "gg``");
  expect([model.line, model.column]).toEqual([1, 6]);
});

test("lowercase marks support linewise and exact jumps without corrupting Unicode columns", () => {
  const model = new VimNavigation("  a🙂bc\nother\nlast\n");
  model.jump(0, 5);
  keys(model, "maG`a");
  expect([model.line, model.column]).toEqual([0, 5]);
  keys(model, "G'a");
  expect([model.line, model.column]).toEqual([0, 2]);
  keys(model, "Gmzgg'z");
  expect(model.line).toBe(2);
  keys(model, "'x");
  expect(model.line).toBe(2);
  keys(model, "m");
  model.key("Escape");
  keys(model, "gg'z");
  expect(model.line).toBe(2);
  const other = new VimNavigation(model.text, "other-snapshot");
  keys(other, "'z''");
  expect(other.line).toBe(0);
});

test("search previews do not overwrite jump-back, but accepted search and match motions do", () => {
  const model = new VimNavigation("one\nmatch\nthree\nmatch\n");
  keys(model, "G");
  const origin = { line: model.line, column: model.column };
  model.setSearch("match", 1);
  model.setMatches(new Uint32Array([4, 16]));
  model.jump(origin.line, origin.column);
  keys(model, "''");
  expect(model.line).toBe(0);
  model.jump(origin.line, origin.column);
  model.setMatches(new Uint32Array([4, 16]));
  model.rememberJump(origin);
  keys(model, "''");
  expect(model.line).toBe(3);
  keys(model, "n``");
  expect(model.line).toBe(3);
});

test("inner words distinguish keyword, punctuation, whitespace, and WORD objects", () => {
  const model = new VimNavigation("one.two  𝒜e\u0301🙂\n");
  keys(model, "lviw");
  expect(model.selectedText()).toBe("one");
  model.key("Escape");
  model.jump(0, 3);
  keys(model, "viw");
  expect(model.selectedText()).toBe(".");
  model.key("Escape");
  model.jump(0, 7);
  keys(model, "viw");
  expect(model.selectedText()).toBe("  ");
  model.key("Escape");
  model.jump(0, 11);
  keys(model, "viw");
  expect(model.selectedText()).toBe("𝒜e\u0301");
  model.key("Escape");
  model.jump(0, 2);
  keys(model, "viW");
  expect(model.selectedText()).toBe("one.two");
});

test("around words use trailing spaces or leading spaces at line end", () => {
  const model = new VimNavigation("one  two.three\nnext");
  keys(model, "vaw");
  expect(model.selectedText()).toBe("one  ");
  model.key("Escape");
  model.jump(0, 4);
  keys(model, "vaw");
  expect(model.selectedText()).toBe("  two");
  model.key("Escape");
  model.jump(0, 10);
  keys(model, "vaW");
  expect(model.selectedText()).toBe("  two.three");
});

test("word counts include whitespace units for inner objects and words for around objects", () => {
  for (const [sequence, expected] of [
    ["v2iw", "one  "],
    ["v3iw", "one  two"],
    ["v2aw", "one  two "],
    ["viwiw", "one  "],
  ]) {
    const model = new VimNavigation("one  two three");
    keys(model, sequence!);
    expect(model.selectedText()).toBe(expected);
  }
});

test("paragraph objects select linewise source including CRLF and blank separators", () => {
  const text = "one\r\ntwo\r\n\r\n\r\nthree\r\nfour";
  const model = new VimNavigation(text);
  model.jump(1, 1);
  keys(model, "vip");
  expect(model.visual?.mode).toBe("line");
  expect(model.selectedText()).toBe("one\r\ntwo\r\n");
  model.key("Escape");
  keys(model, "vap");
  expect(model.selectedText()).toBe("one\r\ntwo\r\n\r\n\r\n");
  model.key("Escape");
  model.jump(2);
  keys(model, "vip");
  expect(model.selectedText()).toBe("\r\n\r\n");
  model.key("Escape");
  keys(model, "vap");
  expect(model.selectedText()).toBe("\r\n\r\nthree\r\nfour");
  model.key("Escape");
  model.jump(5);
  keys(model, "vap");
  expect(model.selectedText()).toBe("\r\n\r\nthree\r\nfour");
});

test("paragraph counts and repeated objects cross empty runs but keep whitespace-only lines", () => {
  const text = "one\n \ntwo\n\n\nthree\n";
  for (const [sequence, expected] of [
    ["v2ip", "one\n \ntwo\n\n\n"],
    ["vipip", "one\n \ntwo\n\n\n"],
    ["v2ap", text],
  ]) {
    const model = new VimNavigation(text);
    keys(model, sequence!);
    expect(model.selectedText()).toBe(expected);
  }
});

test("canceled and unknown text objects preserve the read-only cursor and reset prefixes", () => {
  const model = new VimNavigation("one\n\nlast");
  expect(model.key("i").handled).toBe(false);
  keys(model, "vi");
  model.key("Escape");
  expect(model.visualRange).toBeNull();
  keys(model, "jviw");
  expect([model.line, model.column]).toEqual([1, 0]);
  expect(model.selectedText()).toBe("\n");
  keys(model, "ix");
  expect(model.prefix).toBe("");
  expect(model.text).toBe("one\n\nlast");
  const empty = new VimNavigation("");
  keys(empty, "vip");
  expect(empty.selectedText()).toBe("");
});

test("quoted objects handle escapes, adjacent whitespace, and empty contents", () => {
  for (const quote of ['"', "'", "`"])
    for (const around of [false, true]) {
      const model = new VimNavigation(`call(${quote}a\\${quote}b${quote}  );`);
      model.jump(0, 7);
      keys(model, `v${around ? "a" : "i"}${quote}`);
      expect(model.selectedText()).toBe(around ? `${quote}a\\${quote}b${quote}  ` : `a\\${quote}b`);
    }
  const empty = new VimNavigation('call("");');
  empty.jump(0, 5);
  keys(empty, 'vi"');
  expect(empty.selectedText()).toBe("");
  keys(empty, "l");
  expect(empty.selectedText()).toBe('")');
  empty.key("Escape");
  expect(empty.visualRange).toBeNull();
});

test("bracket objects handle nested multiline pairs, counts, and quoted delimiters", () => {
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    const text = `${open}\r\n  ${open}one "${close}" two${close}\r\n${close}`;
    const model = new VimNavigation(text);
    model.jump(1, 4);
    keys(model, `vi${open}`);
    expect(model.selectedText()).toBe(`one "${close}" two`);
    keys(model, `i${open}`);
    expect(model.selectedText()).toBe(`\r\n  ${open}one "${close}" two${close}\r\n`);
    model.key("Escape");
    model.jump(1, 4);
    keys(model, `v2a${close}`);
    expect(model.selectedText()).toBe(text);
  }
  const empty = new VimNavigation("()");
  keys(empty, "vib");
  expect(empty.selectedText()).toBe("");
  keys(empty, "ab");
  expect(empty.selectedText()).toBe("()");
});

test("unmatched objects leave selections unchanged and word objects keep full graphemes", () => {
  const model = new VimNavigation("a (unclosed");
  keys(model, "vi(");
  expect(model.selectedText()).toBe("a");
  const emoji = new VimNavigation("☀️ next");
  keys(emoji, "viw");
  expect(emoji.selectedText()).toBe("☀️");
});

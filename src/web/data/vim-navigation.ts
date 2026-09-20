/** Read-only Vim motions over file bytes; DOM rows are never the text model. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const MAX_VIM_MATCHES = 200_000;
const keyword = /[\p{L}\p{N}\p{M}_]/u;
const floorIndex = (values: number[], value: number) => {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
};
const kind = (char: string) => (/\s/u.test(char) ? 0 : keyword.test(char) ? 1 : 2);
export type VimMotion = {
  handled: boolean;
  align?: "start" | "center" | "end";
  search?: 1 | -1;
  wordSearch?: string;
  lineCommand?: true;
  copy?: true;
  definition?: string;
};
export type VisualMode = "character" | "line";
export interface VisualRange {
  mode: VisualMode;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}
export class VimNavigation {
  readonly lines: string[];
  readonly starts: number[] = [];
  line = 0;
  column = 0;
  desired = 0;
  count = "";
  prefix = "";
  find: { key: string; char: string } | undefined;
  query = "";
  direction: 1 | -1 = 1;
  matches: number[] = [];
  visual: { mode: VisualMode; line: number; column: number } | null = null;
  get visualRange(): VisualRange | null {
    if (!this.visual) return null;
    const anchor = this.starts[this.visual.line]! + this.visual.column;
    const forward = anchor <= this.offset;
    const startLine = forward ? this.visual.line : this.line;
    const endLine = forward ? this.line : this.visual.line;
    if (this.visual.mode === "line")
      return {
        mode: "line",
        startLine,
        endLine,
        start: this.starts[startLine]!,
        end: this.starts[endLine + 1] ?? this.text.length,
      };
    const column = forward ? this.column : this.visual.column;
    const columns = this.geometry(endLine).columns;
    const length =
      (columns[floorIndex(columns, column) + 1] ?? this.lines[endLine]!.length) - column;
    return {
      mode: "character",
      startLine,
      endLine,
      start: Math.min(anchor, this.offset),
      end: length
        ? this.starts[endLine]! + column + length
        : (this.starts[endLine + 1] ?? this.text.length),
    };
  }
  selectedText() {
    const range = this.visualRange;
    return range ? this.text.slice(range.start, range.end) : "";
  }
  clearVisual() {
    this.visual = null;
  }

  private boundaries = new Map<number, { columns: number[]; display: number[] }>();
  constructor(
    readonly text: string,
    readonly identity = "",
  ) {
    this.lines = text.split("\n");
    if (this.lines.length > 1 && this.lines.at(-1) === "") this.lines.pop();
    let offset = 0;
    for (const line of this.lines) {
      this.starts.push(offset);
      offset += line.length + 1;
    }
    this.lines = this.lines.map((line) => line.replace(/\r$/, ""));
  }
  private geometry(line = this.line) {
    let value = this.boundaries.get(line);
    if (!value) {
      const text = this.lines[line]!;
      const columns: number[] = [],
        display: number[] = [];
      let visual = 0;
      if (/^[\t -~]*$/.test(text)) {
        for (let i = 0; i < text.length; i++) {
          columns.push(i);
          display.push(visual);
          visual += text[i] === "\t" ? 2 - (visual % 2) : 1;
        }
      } else {
        for (const part of segmenter.segment(text)) {
          columns.push(part.index);
          display.push(visual);
          visual +=
            part.segment === "\t"
              ? 2 - (visual % 2)
              : /[\p{Extended_Pictographic}\u3000-\u9fff]/u.test(part.segment)
                ? 2
                : 1;
        }
      }
      if (!columns.length) {
        columns.push(0);
        display.push(0);
      }
      value = { columns, display };
      if (this.boundaries.size > 256) this.boundaries.clear();
      this.boundaries.set(line, value);
    }
    return value;
  }
  private columns() {
    return this.geometry().columns;
  }
  get offset() {
    return this.starts[this.line]! + this.column;
  }
  wordAtCursor() {
    const text = this.lines[this.line]!;
    let start = this.column,
      end = this.column;
    if (!keyword.test(text[start] ?? "")) return "";
    while (start > 0 && keyword.test(text[start - 1]!)) start--;
    while (end < text.length && keyword.test(text[end]!)) end++;
    return text.slice(start, end);
  }
  get endColumn() {
    return this.columns().at(-1)!;
  }
  get characterLength() {
    const columns = this.columns();
    return (
      (columns[floorIndex(columns, this.column) + 1] ?? this.lines[this.line]!.length) - this.column
    );
  }
  jump(line: number, column = 0, preserve = false) {
    this.line = Math.max(0, Math.min(this.lines.length - 1, line));
    const { columns, display } = this.geometry();
    const index = floorIndex(preserve ? display : columns, column);
    this.column = columns[index]!;
    if (!preserve) this.desired = display[index]!;
  }
  jumpOffset(offset: number) {
    let lo = 0,
      hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid]! <= offset) lo = mid + 1;
      else hi = mid;
    }
    const line = Math.max(0, lo - 1);
    this.jump(line, offset - this.starts[line]!);
  }
  goToLine(input: string): "empty" | "invalid" | "moved" {
    const value = input.trim();
    if (!value) return "empty";
    const line = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(line) || line < 1) return "invalid";
    this.jump(line - 1);
    return "moved";
  }
  restoreSearch(state: {
    line: number;
    column: number;
    desired: number;
    query: string;
    direction: 1 | -1;
    matches: number[];
  }) {
    this.jump(state.line, state.column);
    this.desired = state.desired;
    this.setSearch(state.query, state.direction);
    this.matches = state.matches;
  }
  setSearch(query: string, direction: 1 | -1) {
    this.query = query;
    this.direction = direction;
  }
  setMatches(matches: Uint32Array) {
    this.matches = Array.from(matches);
    this.nextMatch();
  }
  nextMatch(direction = this.direction, count = 1) {
    if (!this.matches.length) return;
    let lo = 0,
      hi = this.matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.matches[mid]! <= this.offset) lo = mid + 1;
      else hi = mid;
    }
    let index = direction === 1 ? lo : lo - 1;
    if (direction === -1 && this.matches[index] === this.offset) index--;
    index =
      (((index + direction * (count - 1)) % this.matches.length) + this.matches.length) %
      this.matches.length;
    this.jumpOffset(this.matches[index]!);
  }
  private word(motion: string) {
    let position = this.offset;
    const end = this.text.length;
    const next = (at: number) =>
      Math.min(end, at + ((this.text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1));
    const previous = (at: number) =>
      Math.max(0, at - (/[\uDC00-\uDFFF]/.test(this.text[at - 1] ?? "") ? 2 : 1));
    const typeAt = (at: number) => kind(String.fromCodePoint(this.text.codePointAt(at) ?? 32));
    if (motion === "b") {
      position = previous(position);
      while (position > 0 && typeAt(position) === 0) position = previous(position);
      const type = typeAt(position);
      while (position > 0 && typeAt(previous(position)) === type) position = previous(position);
    } else if (motion === "w") {
      const type = typeAt(position);
      while (position < end && typeAt(position) === type) position = next(position);
      while (position < end && typeAt(position) === 0) position = next(position);
    } else {
      position = next(position);
      while (position < end && typeAt(position) === 0) position = next(position);
      const type = typeAt(position);
      while (next(position) < end && typeAt(next(position)) === type) position = next(position);
    }
    this.jumpOffset(Math.min(Math.max(0, end - 1), position));
  }
  private characterFind(key: string, char: string, count: number, repeated = false) {
    const forward = key === "f" || key === "t";
    const till = key.toLowerCase() === "t";
    let position = this.column;
    for (let i = 0; i < count; i++) {
      const skip = repeated && till && i === 0 ? 2 : 1;
      const next = forward
        ? this.lines[this.line]!.indexOf(char, position + skip)
        : this.lines[this.line]!.lastIndexOf(char, position - skip);
      if (next < 0 || (!forward && position - skip < 0)) return;
      position = next;
    }
    const columns = this.columns();
    const index = floorIndex(columns, position);
    if (till && index >= 0)
      position = columns[Math.max(0, Math.min(columns.length - 1, index + (forward ? -1 : 1)))]!;
    this.jump(this.line, position);
  }
  key(key: string, control = false, halfPage = 10): VimMotion {
    if (key === "Escape") {
      this.clearVisual();
      this.count = "";
      this.prefix = "";
      return { handled: true };
    }
    if (control) {
      if (key !== "d" && key !== "u") return { handled: false };
      const n = Math.min(200000, Number(this.count) || halfPage);
      this.count = "";
      this.prefix = "";
      this.jump(this.line + (key === "d" ? n : -n), this.desired, true);
      return { handled: true };
    }
    if (/^[0-9]$/.test(key) && (key !== "0" || this.count) && !/[fFtT]/.test(this.prefix)) {
      this.count = (this.count + key).slice(0, 6);
      return { handled: true };
    }
    if (!this.prefix && ["g", "z", "f", "F", "t", "T"].includes(key)) {
      this.prefix = key;
      return { handled: true };
    }
    const n = Math.min(200000, Number(this.count) || 1);
    const explicit = !!this.count;
    const prefix = this.prefix;
    this.prefix = "";
    this.count = "";
    if (["f", "F", "t", "T"].includes(prefix)) {
      if (Array.from(key).length === 1) {
        this.find = { key: prefix, char: key };
        this.characterFind(prefix, key, n);
      }
      return { handled: true };
    }
    if (prefix === "g") {
      if (key === "g") this.jump(explicit ? n - 1 : 0);
      if (key === "d") return { handled: true, definition: this.wordAtCursor() };
      return { handled: true };
    }
    if (prefix === "z") {
      const align =
        key === "t" ? "start" : key === "z" ? "center" : key === "b" ? "end" : undefined;
      if (align && explicit) this.jump(n - 1, this.desired, true);
      return { handled: true, ...(align ? { align } : {}) };
    }
    if (key === "v" || key === "V") {
      const mode = key === "v" ? "character" : "line";
      if (this.visual?.mode === mode) this.clearVisual();
      else
        this.visual = this.visual
          ? { ...this.visual, mode }
          : { mode, line: this.line, column: this.column };
      return { handled: true };
    }
    if (this.visual && key === "y") return { handled: true, copy: true };
    if (this.visual && key === "o") {
      const anchor = this.visual;
      this.visual = { mode: anchor.mode, line: this.line, column: this.column };
      this.jump(anchor.line, anchor.column);
      return { handled: true };
    }
    if (key === "j" || key === "k")
      this.jump(this.line + (key === "j" ? n : -n), this.desired, true);
    else if (key === "h" || key === "l") {
      const columns = this.columns();
      const index = floorIndex(columns, this.column);
      this.jump(
        this.line,
        columns[Math.max(0, Math.min(columns.length - 1, index + (key === "l" ? n : -n)))]!,
      );
    } else if (["w", "b", "e"].includes(key)) {
      for (let i = 0; i < n; i++) this.word(key);
    } else if (key === "0") this.jump(this.line);
    else if (key === "^") this.jump(this.line, Math.max(0, this.lines[this.line]!.search(/\S/)));
    else if (key === "$" || key === "A") {
      this.jump(this.line + (key === "$" ? n - 1 : 0));
      this.jump(this.line, this.endColumn);
      this.desired = Infinity;
    } else if (key === "G") this.jump(explicit ? n - 1 : this.lines.length - 1);
    else if (key === ":") {
      this.clearVisual();
      return { handled: true, lineCommand: true };
    } else if (key === "{" || key === "}") {
      const direction = key === "}" ? 1 : -1;
      let line = this.line;
      for (let i = 0; i < n; i++) {
        while (
          line + direction >= 0 &&
          line + direction < this.lines.length &&
          this.lines[line] === ""
        )
          line += direction;
        if (line + direction >= 0 && line + direction < this.lines.length) line += direction;
        while (
          line + direction >= 0 &&
          line + direction < this.lines.length &&
          this.lines[line] !== ""
        )
          line += direction;
      }
      this.jump(line);
    } else if (key === ";" || key === ",") {
      if (this.find) {
        const original = this.find.key;
        const opposite =
          original === original.toLowerCase() ? original.toUpperCase() : original.toLowerCase();
        this.characterFind(key === ";" ? original : opposite, this.find.char, n, true);
      }
    } else if (key === "/" || key === "?") return { handled: true, search: key === "/" ? 1 : -1 };
    else if (key === "n" || key === "N")
      this.nextMatch(key === "n" ? this.direction : this.direction === 1 ? -1 : 1, n);
    else if (key === "*" || key === "#") {
      const text = this.lines[this.line]!;
      let start = this.column,
        end = this.column;
      if (!keyword.test(text[start] ?? "")) return { handled: true };
      while (start > 0 && keyword.test(text[start - 1]!)) start--;
      while (end < text.length && keyword.test(text[end]!)) end++;
      return { handled: true, search: key === "*" ? 1 : -1, wordSearch: text.slice(start, end) };
    } else return { handled: false };
    return { handled: true };
  }
}
/** Literal, smart-case search. Offsets are UTF-16, matching browser text ranges. */
export function findVimMatches(text: string, query: string, wholeWord = false): number[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])` : escaped,
    /\p{Lu}/u.test(query) ? "gu" : "giu",
  );
  const matches: number[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push(match.index);
    if (matches.length === MAX_VIM_MATCHES) break;
  }
  return matches;
}

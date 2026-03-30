import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
} from "@chenglou/pretext";
import type { PageLine, PreparedInlineItem } from "./types";
import { LINE_START_CURSOR, cursorsMatch } from "./measure";
import type { LayoutCursor } from "@chenglou/pretext";

export function layoutTextLines(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] {
  const safeWidth = Math.max(1, maxWidth);
  const lines: PageLine[] = [];

  let itemIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (itemIndex < items.length) {
    const fragments: PageLine["fragments"] = [];
    let remainingWidth = safeWidth;

    lineLoop: while (itemIndex < items.length) {
      const item = items[itemIndex];
      if (!item) break;

      if (item.kind === "atomic") {
        const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
        if (fragments.length > 0 && leadingGap + item.width > remainingWidth) {
          break lineLoop;
        }
        fragments.push({
          text: item.content.alt ?? "",
          font: "",
          leadingGap,
          isLink: false,
          isCode: false,
        });
        remainingWidth -= leadingGap + item.width;
        itemIndex++;
        continue;
      }

      // kind === 'text'
      if (textCursor && cursorsMatch(textCursor, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
      const reservedWidth = leadingGap + item.chromeWidth;

      if (fragments.length > 0 && reservedWidth >= remainingWidth) {
        break lineLoop;
      }

      // Fast path: whole run fits
      if (!textCursor) {
        const fullWidth = leadingGap + item.fullWidth + item.chromeWidth;
        if (fullWidth <= remainingWidth) {
          fragments.push({
            text: item.fullText,
            font: item.font,
            leadingGap,
            isLink: item.isLink,
            isCode: item.isCode,
          });
          remainingWidth -= fullWidth;
          itemIndex++;
          continue;
        }
      }

      // Slow path: split via layoutNextLine
      const start = textCursor ?? LINE_START_CURSOR;
      const line = layoutNextLine(
        item.prepared,
        start,
        Math.max(1, remainingWidth - reservedWidth),
      );

      if (!line || cursorsMatch(start, line.end)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      fragments.push({
        text: line.text,
        font: item.font,
        leadingGap,
        isLink: item.isLink,
        isCode: item.isCode,
      });
      remainingWidth -= leadingGap + line.width + item.chromeWidth;

      if (cursorsMatch(line.end, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      textCursor = line.end;
      break lineLoop;
    }

    if (fragments.length === 0) break;
    lines.push({ fragments });
  }

  return lines;
}

export function layoutPreWrapLines(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] {
  if (items.length === 0) return [];

  const firstText = items.find((i) => i.kind === "text");
  if (!firstText || firstText.kind !== "text") return [];

  const combinedText = items
    .map((i) => (i.kind === "text" ? i.fullText : ""))
    .join("");
  const font = firstText.font;

  const prepared = prepareWithSegments(combinedText, font, {
    whiteSpace: "pre-wrap",
  });
  const result = layoutWithLines(prepared, Math.max(1, maxWidth), 1);

  return result.lines.map((line) => ({
    fragments: [
      {
        text: line.text,
        font,
        leadingGap: 0,
        isLink: firstText.isLink,
        isCode: true,
      },
    ],
  }));
}

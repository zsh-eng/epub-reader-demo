import { ScrollArea } from "@/components/ui/scroll-area";
import type { Highlight } from "@/types/highlight";
import { Highlighter } from "lucide-react";
import { useMemo } from "react";
import type { ChapterEntry } from "./types";

interface ReaderHighlightsPanelProps {
  highlights: Highlight[];
  chapters: ChapterEntry[];
  onSelect: (highlight: Highlight) => void;
}

/** Book-order highlights share the Reader's live data and navigation commands. */
export function ReaderHighlightsPanel({
  highlights,
  chapters,
  onSelect,
}: ReaderHighlightsPanelProps) {
  const groups = useMemo(
    () =>
      chapters.flatMap((chapter) => {
        const entries = highlights
          .filter(
            (highlight) =>
              highlight.spineItemId === chapter.spineItemId &&
              highlight.color !== "invisible",
          )
          .sort(
            (a, b) =>
              a.startOffset - b.startOffset || a.createdAt - b.createdAt,
          );
        return entries.length ? [{ chapter, entries }] : [];
      }),
    [chapters, highlights],
  );
  const count = groups.reduce(
    (total, group) => total + group.entries.length,
    0,
  );

  return (
    <section
      aria-label="Book highlights"
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex items-center justify-between px-4 py-2">
        <h2 className="text-sm font-medium">Highlights</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <Highlighter
            className="mb-4 size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">No highlights yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select text in the book and choose a highlight colour.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
          {groups.map(({ chapter, entries }) => (
            <section key={chapter.spineItemId} className="mt-4 first:mt-2">
              <h3 className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {chapter.title}
              </h3>
              {entries.map((highlight) => (
                <button
                  key={highlight.id}
                  type="button"
                  aria-label={`Go to highlight: ${highlight.selectedText}`}
                  onClick={() => onSelect(highlight)}
                  className="block w-full rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <blockquote
                    className="whitespace-pre-wrap break-words border-l-[3px] pl-3 text-sm leading-relaxed"
                    style={{
                      borderColor: `var(--${highlight.color}-secondary)`,
                    }}
                  >
                    {highlight.selectedText}
                  </blockquote>
                </button>
              ))}
            </section>
          ))}
        </ScrollArea>
      )}
    </section>
  );
}

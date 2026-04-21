import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useBookSearch } from "@/hooks/use-book-search";
import type { SearchMatch, ChapterSearchResult } from "@/lib/book-search";
import { cn } from "@/lib/utils";
import { Loader2, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchPopoverProps {
  bookId: string | undefined;
  onNavigateToMatch: (chapterPath: string, position: number) => void;
}

/**
 * SearchPopover Component
 *
 * A popover for full-text search within the current book.
 * Opens above the control island with a slide-up animation.
 */
export function SearchPopover({
  bookId,
  onNavigateToMatch,
}: SearchPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    searchResults,
    isExtracting,
    isSearching,
    extractionProgress,
    isReady,
    search,
    clearSearch,
  } = useBookSearch(bookId);

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Search immediately on query/option change
  useEffect(() => {
    if (!query.trim()) {
      clearSearch();
      return;
    }

    search(query, { caseSensitive, wholeWord });
  }, [query, caseSensitive, wholeWord, search, clearSearch]);

  const handleClear = useCallback(() => {
    setQuery("");
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const handleMatchClick = useCallback(
    (match: SearchMatch) => {
      onNavigateToMatch(match.chapterPath, match.position);
      setIsOpen(false);
    },
    [onNavigateToMatch],
  );

  const isLoading = isExtracting || isSearching;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-full",
            isOpen && "bg-accent text-accent-foreground",
          )}
          aria-label="Search in book"
        >
          <Search className="size-4" />
        </Button>
      </PopoverTrigger>
      <AnimatePresence>
        {isOpen && (
          <PopoverContent
            asChild
            side="top"
            sideOffset={12}
            align="center"
            className="p-0 w-md"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="rounded-xl bg-background/95 backdrop-blur-md border shadow-lg overflow-hidden"
            >
              {/* Header with search input */}
              <div className="px-4 py-3 border-b border-border space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    type="text"
                    placeholder="Search in book..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9 pr-9"
                    disabled={!isReady && !isExtracting}
                  />
                  {query && (
                    <button
                      onClick={handleClear}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>

                {/* Search options */}
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={caseSensitive}
                      onCheckedChange={setCaseSensitive}
                      className="scale-75 origin-left"
                    />
                    <span className="text-muted-foreground">Match case</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={wholeWord}
                      onCheckedChange={setWholeWord}
                      className="scale-75 origin-left"
                    />
                    <span className="text-muted-foreground">Whole word</span>
                  </label>
                </div>
              </div>

              {/* Results area */}
              <ScrollArea className="h-[50vh]">
                <div className="p-2">
                  {/* Extraction progress */}
                  {isExtracting && (
                    <div className="flex items-center gap-3 px-3 py-4 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Preparing search... {extractionProgress}%</span>
                    </div>
                  )}

                  {/* Searching indicator */}
                  {isSearching && !isExtracting && (
                    <div className="flex items-center gap-3 px-3 py-4 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Searching...</span>
                    </div>
                  )}

                  {/* No query state */}
                  {!isLoading && !query.trim() && isReady && (
                    <p className="text-sm text-muted-foreground px-3 py-4 text-center">
                      Enter a search term to find text in this book
                    </p>
                  )}

                  {/* No results */}
                  {!isLoading &&
                    query.trim() &&
                    searchResults &&
                    searchResults.totalMatches === 0 && (
                      <p className="text-sm text-muted-foreground px-3 py-4 text-center">
                        No matches found for "{query}"
                      </p>
                    )}

                  {/* Results */}
                  {!isLoading &&
                    searchResults &&
                    searchResults.totalMatches > 0 && (
                      <div className="space-y-2">
                        {/* Summary */}
                        <div className="px-3 py-1 text-xs text-muted-foreground">
                          {searchResults.totalMatches} match
                          {searchResults.totalMatches !== 1 ? "es" : ""} in{" "}
                          {searchResults.byChapter.length} chapter
                          {searchResults.byChapter.length !== 1 ? "s" : ""}
                        </div>

                        {/* Results by chapter */}
                        {searchResults.byChapter.map((chapter) => (
                          <ChapterResults
                            key={chapter.chapterPath}
                            chapter={chapter}
                            query={query}
                            onMatchClick={handleMatchClick}
                          />
                        ))}
                      </div>
                    )}
                </div>
              </ScrollArea>
            </motion.div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  );
}

/**
 * Displays search results for a single chapter
 */
function ChapterResults({
  chapter,
  query,
  onMatchClick,
}: {
  chapter: ChapterSearchResult;
  query: string;
  onMatchClick: (match: SearchMatch) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Chapter header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-sm"
      >
        <span className="font-medium truncate">{chapter.chapterTitle}</span>
        <span className="text-muted-foreground text-xs ml-2 shrink-0">
          {chapter.matches.length} match
          {chapter.matches.length !== 1 ? "es" : ""}
        </span>
      </button>

      {/* Matches */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="divide-y divide-border">
              {chapter.matches.slice(0, 10).map((match, idx) => (
                <button
                  key={idx}
                  onClick={() => onMatchClick(match)}
                  className="w-full text-left px-3 py-2 hover:bg-accent transition-colors text-sm"
                >
                  <HighlightedContext context={match.context} query={query} />
                </button>
              ))}
              {chapter.matches.length > 10 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{chapter.matches.length - 10} more matches
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Highlights the matched query within the context string
 */
function HighlightedContext({
  context,
  query,
}: {
  context: string;
  query: string;
}) {
  // Simple highlight - find and wrap the query in the context
  const lowerContext = context.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContext.indexOf(lowerQuery);

  if (index === -1) {
    return <span className="text-muted-foreground">{context}</span>;
  }

  const before = context.slice(0, index);
  const match = context.slice(index, index + query.length);
  const after = context.slice(index + query.length);

  return (
    <span className="text-muted-foreground">
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-900 text-foreground px-0.5 rounded">
        {match}
      </mark>
      {after}
    </span>
  );
}

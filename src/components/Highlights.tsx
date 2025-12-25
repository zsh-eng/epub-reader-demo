/**
 * Highlights Page
 *
 * Displays all highlights across all books, grouped by book,
 * with search and color filtering.
 */

import { HighlightCard } from "@/components/HighlightCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFileUrl } from "@/hooks/use-file-url";
import {
  filterByColors,
  filterBySearch,
  useAllHighlightsQuery,
  type BookHighlightGroup,
} from "@/hooks/use-all-highlights-query";
import { deleteHighlight as deleteHighlightFromDb } from "@/lib/db";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlight-constants";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Highlighter, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

// Color button styling
const colorButtonStyles: Record<HighlightColor, string> = {
  yellow: "bg-yellow-secondary hover:bg-yellow-secondary/80",
  green: "bg-green-secondary hover:bg-green-secondary/80",
  blue: "bg-blue-secondary hover:bg-blue-secondary/80",
  magenta: "bg-magenta-secondary hover:bg-magenta-secondary/80",
};

function ColorFilterBar({
  selectedColors,
  onToggleColor,
}: {
  selectedColors: HighlightColor[];
  onToggleColor: (color: HighlightColor) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">Filter:</span>
      {HIGHLIGHT_COLORS.map(({ name }) => {
        const isSelected = selectedColors.length === 0 || selectedColors.includes(name);
        return (
          <button
            key={name}
            onClick={() => onToggleColor(name)}
            className={`
              w-6 h-6 rounded-full transition-all
              ${colorButtonStyles[name]}
              ${isSelected ? "ring-2 ring-offset-2 ring-offset-background ring-foreground/50 scale-110" : "opacity-40"}
            `}
            title={`${name} ${isSelected ? "(showing)" : "(hidden)"}`}
          />
        );
      })}
      {selectedColors.length > 0 && (
        <button
          onClick={() => selectedColors.forEach(onToggleColor)}
          className="text-xs text-muted-foreground hover:text-foreground ml-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function BookCoverThumbnail({ coverContentHash }: { coverContentHash?: string }) {
  const { url: coverUrl } = useFileUrl(coverContentHash, "cover", {
    skip: !coverContentHash,
  });

  if (!coverUrl) {
    return (
      <div className="w-12 h-16 bg-secondary rounded flex items-center justify-center flex-shrink-0">
        <Highlighter className="w-5 h-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={coverUrl}
      alt="Book cover"
      className="w-12 h-16 object-cover rounded flex-shrink-0"
    />
  );
}

function BookSection({ group, headerHeight }: { group: BookHighlightGroup; headerHeight: number }) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: deleteHighlightFromDb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["highlights"] });
    },
  });

  return (
    <section className="mb-8">
      {/* Book Header - sticky on mobile */}
      <div 
        className="sticky md:static z-10 bg-background/95 backdrop-blur-sm py-3 -mx-4 px-4 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none border-b md:border-none border-border mb-4"
        style={{ top: headerHeight }}
      >
        <div className="flex items-center gap-3">
          <BookCoverThumbnail coverContentHash={group.book.coverContentHash} />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground truncate">{group.book.title}</h2>
            <p className="text-sm text-muted-foreground truncate">
              {group.book.author} • {group.highlights.length} highlight{group.highlights.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Highlights */}
      <div className="space-y-3 overflow-hidden">
        <AnimatePresence initial={false}>
          {group.highlights.map((highlight) => (
            <motion.div
              key={highlight.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <HighlightCard
                highlight={highlight}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

export function Highlights() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedColors, setSelectedColors] = useState<HighlightColor[]>([]);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLElement>(null);

  const { data: groups = [], isLoading } = useAllHighlightsQuery();

  // Measure header height on mount and resize
  useEffect(() => {
    const measureHeader = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.getBoundingClientRect().height);
      }
    };
    measureHeader();
    window.addEventListener("resize", measureHeader);
    return () => window.removeEventListener("resize", measureHeader);
  }, []);

  const handleToggleColor = (color: HighlightColor) => {
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    );
  };

  // Apply filters
  const filteredGroups = useMemo(() => {
    let result = groups;
    result = filterByColors(result, selectedColors);
    result = filterBySearch(result, searchQuery);
    return result;
  }, [groups, selectedColors, searchQuery]);

  const totalHighlights = filteredGroups.reduce((sum, g) => sum + g.highlights.length, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground text-sm">Loading highlights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header - sticky */}
      <header ref={headerRef} className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {/* Top row: back button and title */}
          <div className="flex items-center gap-3 mb-4">
            <Link to="/">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="text-left">
              <h1 className="text-lg font-semibold">Highlights</h1>
              <p className="text-xs text-muted-foreground">
                {totalHighlights} highlight{totalHighlights !== 1 ? "s" : ""} across {filteredGroups.length} book{filteredGroups.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search highlights..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Color filters */}
          <ColorFilterBar selectedColors={selectedColors} onToggleColor={handleToggleColor} />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6 overflow-hidden">
        {filteredGroups.length > 0 ? (
          <AnimatePresence initial={false}>
            {filteredGroups.map((group) => (
              <motion.div
                key={group.book.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <BookSection group={group} headerHeight={headerHeight} />
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="bg-secondary/50 p-6 rounded-full mb-6">
              <Highlighter className="h-12 w-12 text-muted-foreground/50" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {searchQuery || selectedColors.length > 0 ? "No highlights found" : "No highlights yet"}
            </h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {searchQuery || selectedColors.length > 0
                ? "Try adjusting your search or filters"
                : "Start reading and highlighting text to see them here"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

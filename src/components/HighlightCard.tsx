/**
 * HighlightCard Component
 *
 * Displays a single highlight as a compact messaging-style bubble
 * with color dot, text, and inline timestamp.
 */

import { Button } from "@/components/ui/button";
import { formatHighlightTime } from "@/lib/date-utils";
import type { SyncedHighlight } from "@/lib/db";
import { BookOpen, Pencil, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface HighlightCardProps {
  highlight: SyncedHighlight;
  onDelete?: (highlightId: string) => void;
  onEdit?: (highlightId: string) => void;
}

// Color dot classes for highlight indicator
const colorDotClasses: Record<string, string> = {
  yellow: "bg-yellow-secondary",
  green: "bg-green-secondary",
  blue: "bg-blue-secondary",
  magenta: "bg-magenta-secondary",
};

export function HighlightCard({ highlight, onDelete, onEdit }: HighlightCardProps) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCardClick = () => {
    setIsExpanded(!isExpanded);
  };

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/reader/${highlight.bookId}`, {
      state: {
        scrollToHighlight: {
          spineItemId: highlight.spineItemId,
          highlightId: highlight.id,
        },
      },
    });
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(highlight.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this highlight?")) {
      onDelete?.(highlight.id);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(false);
  };

  const colorDotClass = colorDotClasses[highlight.color] ?? "bg-muted-foreground";
  const formattedTime = formatHighlightTime(highlight.createdAt);

  return (
    <motion.div
      layout
      onClick={handleCardClick}
      className="relative inline-block max-w-full"
    >
      <div
        className={`
          relative px-3 py-2 rounded-xl bg-card border border-border
          cursor-pointer transition-colors
          hover:bg-accent/50
        `}
      >
        {/* Highlight text with inline timestamp */}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-foreground leading-relaxed line-clamp-3 break-words">
            "{highlight.selectedText}"
          </p>

          {/* Note preview (if exists) */}
          {highlight.note && (
            <p className="text-xs text-muted-foreground italic line-clamp-2">
              💬 {highlight.note}
            </p>
          )}

          {/* Timestamp with color dot - bottom right */}
          <div className="flex items-center justify-end gap-1.5 mt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${colorDotClass}`}
              aria-label={`${highlight.color} highlight`}
            />
            <span className="text-[11px] text-muted-foreground">
              {formattedTime}
            </span>
          </div>
        </div>

        {/* Action buttons (shown when expanded) */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute top-2 right-2 flex items-center gap-1"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                onClick={handleNavigate}
                title="Go to highlight"
              >
                <BookOpen className="h-4 w-4" />
              </Button>
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                  onClick={handleEdit}
                  title="Edit note"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  title="Delete highlight"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                onClick={handleClose}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

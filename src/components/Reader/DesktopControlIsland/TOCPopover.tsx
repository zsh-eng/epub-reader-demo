import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TOCItem } from "@/lib/db";
import { cn } from "@/lib/utils";
import { List } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface TOCPopoverProps {
  toc: TOCItem[];
  currentChapterHref: string;
  onNavigateToChapter: (href: string) => void;
}

// Flatten nested TOC structure into a linear list
function flattenTOC(items: TOCItem[]): TOCItem[] {
  const result: TOCItem[] = [];

  function traverse(items: TOCItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return result;
}

// Normalize href for comparison (remove leading slashes and fragments)
function normalizeHref(href: string) {
  return href.split("#")[0].replace(/^\/+/, "");
}

/**
 * TOCPopover Component
 *
 * A popover that shows the Table of Contents.
 * Opens above the control island with a slide-up animation.
 */
export function TOCPopover({
  toc,
  currentChapterHref,
  onNavigateToChapter,
}: TOCPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const currentItemRef = useRef<HTMLButtonElement>(null);
  const flatTOC = flattenTOC(toc);
  const currentNormalizedHref = normalizeHref(currentChapterHref);

  // Auto-scroll to current chapter when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        currentItemRef.current?.scrollIntoView({
          block: "center",
          behavior: "instant",
        });
      }, 100);
    }
  }, [isOpen]);

  const handleNavigate = (href: string) => {
    onNavigateToChapter(href);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Table of Contents"
        >
          <List className="size-4" />
        </Button>
      </PopoverTrigger>
      <AnimatePresence>
        {isOpen && (
          <PopoverContent
            asChild
            side="top"
            sideOffset={12}
            align="center"
            className="p-0 w-[320px]"
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
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-medium text-sm">Table of Contents</h3>
              </div>
              <ScrollArea className="h-[50vh]">
                <div className="p-2">
                  {flatTOC && flatTOC.length > 0 ? (
                    <div className="space-y-0.5">
                      {flatTOC.map((item, index) => {
                        const itemNormalizedHref = normalizeHref(item.href);
                        const isCurrentChapter =
                          itemNormalizedHref === currentNormalizedHref;

                        return (
                          <button
                            key={index}
                            ref={isCurrentChapter ? currentItemRef : null}
                            onClick={() => handleNavigate(item.href)}
                            className={cn(
                              "w-full text-left px-3 py-2 rounded-lg transition-colors text-sm",
                              isCurrentChapter
                                ? "bg-primary text-primary-foreground font-medium"
                                : "hover:bg-accent",
                            )}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground px-3 py-2">
                      No table of contents available
                    </p>
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

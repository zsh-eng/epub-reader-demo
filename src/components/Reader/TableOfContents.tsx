import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type TOCItem } from "@/lib/db";

/**
 * TableOfContents Component
 *
 * Displays the table of contents in a side sheet/drawer.
 * Supports nested TOC items with recursive rendering and indentation.
 */
export interface TableOfContentsProps {
  toc: TOCItem[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
}

/**
 * TOCItems Component
 *
 * Recursively renders TOC items with proper indentation based on nesting level.
 */
interface TOCItemsProps {
  items: TOCItem[];
  level: number;
  onNavigate: (href: string) => void;
}

function TOCItems({ items, level, onNavigate }: TOCItemsProps) {
  return (
    <>
      {items.map((item, index) => (
        <div key={`${level}-${index}`} style={{ paddingLeft: `${level * 16}px` }}>
          <button
            onClick={() => onNavigate(item.href)}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-none transition-colors text-sm"
          >
            {item.label}
          </button>
          {item.children && item.children.length > 0 && (
            <TOCItems items={item.children} level={level + 1} onNavigate={onNavigate} />
          )}
        </div>
      ))}
    </>
  );
}

export function TableOfContents({
  toc,
  isOpen,
  onOpenChange,
  onNavigate,
}: TableOfContentsProps) {
  const handleNavigate = (href: string) => {
    onNavigate(href);
    onOpenChange(false); // Close the sheet after navigation
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>Table of Contents</SheetTitle>
        </SheetHeader>
        <div className="overflow-scroll px-2">
          {toc && toc.length > 0 ? (
            <div className="space-y-1">
              <TOCItems items={toc} level={0} onNavigate={handleNavigate} />
            </div>
          ) : (
            <p className="text-sm text-gray-500 px-3">
              No table of contents available
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

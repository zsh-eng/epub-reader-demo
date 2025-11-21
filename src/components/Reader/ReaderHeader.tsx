import { Button } from "@/components/ui/button";
import { type Book } from "@/lib/db";
import { ArrowLeft, Menu, Palette } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import type { ReaderTheme } from "@/types/reader.types";

/**
 * ReaderHeader Component
 *
 * Displays the book title, current chapter information, and navigation controls.
 * Includes a hamburger menu for TOC and a back-to-library button.
 */
export interface ReaderHeaderProps {
  book: Book;
  currentChapterTitle: string;
  currentChapterIndex: number;
  totalChapters: number;
  onToggleTOC: () => void;
  onBackToLibrary: () => void;
}

export function ReaderHeader({
  book,
  currentChapterTitle,
  currentChapterIndex,
  totalChapters,
  onToggleTOC,
  onBackToLibrary,
}: ReaderHeaderProps) {
  const { settings, updateSettings } = useReaderSettings();

  const themes: { value: ReaderTheme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'sepia', label: 'Sepia' },
    { value: 'flexoki-light', label: 'Flexoki Light' },
    { value: 'flexoki-dark', label: 'Flexoki Dark' },
  ];

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background sticky top-0 z-10 transition-colors duration-200">
      {/* Hamburger Menu */}
      <Button variant="ghost" size="icon" onClick={onToggleTOC} aria-label="Table of contents">
        <Menu className="h-5 w-5" />
      </Button>

      {/* Back to Library Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onBackToLibrary}
        aria-label="Back to library"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      {/* Book Info */}
      <div className="flex-1 min-w-0">
        <h1 className="font-semibold text-base truncate">{book.title}</h1>
        <p className="text-xs text-muted-foreground truncate">
          {currentChapterTitle}
        </p>
      </div>

      {/* Theme Toggle */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Theme settings">
            <Palette className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {themes.map((theme) => (
            <DropdownMenuItem
              key={theme.value}
              onClick={() => updateSettings({ theme: theme.value })}
              className={settings.theme === theme.value ? "bg-accent" : ""}
            >
              {theme.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Chapter Progress */}
      <div className="text-xs text-muted-foreground hidden sm:block">
        {currentChapterIndex + 1} / {totalChapters}
      </div>
    </header>
  );
}

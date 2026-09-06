import type { ReactNode } from "react";
import type { Book, TOCItem } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { ReaderContentsSheet } from "./ReaderContentsSheet";
import { ReaderBookActionsSheet } from "./ReaderBookActionsSheet";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import { ReaderToolsLauncherSheet } from "./ReaderToolsLauncherSheet";
import { ReaderToolsSidebar } from "./ReaderToolsSidebar";
import type { ChapterEntry, ReaderSheetId } from "./types";

interface ReaderSheetHostProps {
  isMobile: boolean;
  activeSheet: ReaderSheetId | null;
  onOpenSheet: (sheet: ReaderSheetId) => void;
  onCloseSheet: () => void;
  book: Book;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  onNavigateToHref: (href: string) => boolean;
  notesPanel?: ReactNode;
  onOpenNotes?: () => void;
  onCopyDebugDump?: () => void;
}

/**
 * Coordinates the reader's peer-level overlays.
 *
 * Mobile retains the compact launcher and peer sheets. Desktop tools share one
 * right-side workspace so contents and appearance stay beside the book.
 */
export function ReaderSheetHost({
  isMobile,
  activeSheet,
  onOpenSheet,
  onCloseSheet,
  book,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  onNavigateToHref,
  onOpenNotes,
  onCopyDebugDump,
  notesPanel,
}: ReaderSheetHostProps) {
  if (!isMobile) {
    return (
      <ReaderToolsSidebar
        activeSheet={activeSheet}
        onOpenPanel={onOpenSheet}
        onClose={onCloseSheet}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        toc={toc}
        chapterEntries={chapterEntries}
        chapterStartPages={chapterStartPages}
        currentChapterHref={currentChapterHref}
        onNavigateToHref={onNavigateToHref}
        notesPanel={notesPanel}
        onCopyDebugDump={onCopyDebugDump}
      />
    );
  }

  return (
    <>
      <ReaderToolsLauncherSheet
        isOpen={activeSheet === "tools"}
        onClose={onCloseSheet}
        onOpenContents={() => onOpenSheet("contents")}
        onOpenBookActions={() => onOpenSheet("book-actions")}
        onOpenSettings={() => onOpenSheet("settings")}
        onOpenNotes={onOpenNotes}
        onCopyDebugDump={onCopyDebugDump}
      />

      <ReaderBookActionsSheet
        isOpen={activeSheet === "book-actions"}
        onClose={onCloseSheet}
        onBack={() => onOpenSheet("tools")}
        book={book}
      />

      <ReaderContentsSheet
        isOpen={activeSheet === "contents"}
        onClose={onCloseSheet}
        onBack={() => onOpenSheet("tools")}
        toc={toc}
        chapterEntries={chapterEntries}
        chapterStartPages={chapterStartPages}
        currentChapterHref={currentChapterHref}
        onNavigateToHref={onNavigateToHref}
      />

      <ReaderSettingsSheet
        isOpen={activeSheet === "settings"}
        onClose={onCloseSheet}
        onBack={() => onOpenSheet("tools")}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </>
  );
}

import type { TOCItem } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { ReaderContentsSheet } from "./ReaderContentsSheet";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import { ReaderToolsLauncherSheet } from "./ReaderToolsLauncherSheet";
import type { ChapterEntry, ReaderSheetId } from "./types";

interface ReaderSheetHostProps {
  activeSheet: ReaderSheetId | null;
  onOpenSheet: (sheet: ReaderSheetId) => void;
  onCloseSheet: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  currentChapterTitle?: string;
  onNavigateToHref: (href: string) => boolean;
}

/**
 * Coordinates the reader's peer-level bottom sheets.
 *
 * Keeping these overlays in one host makes their shared lifecycle explicit
 * while each sheet remains a destination that closes directly back to reading.
 */
export function ReaderSheetHost({
  activeSheet,
  onOpenSheet,
  onCloseSheet,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  currentChapterTitle,
  onNavigateToHref,
}: ReaderSheetHostProps) {
  return (
    <>
      <ReaderToolsLauncherSheet
        isOpen={activeSheet === "tools"}
        onClose={onCloseSheet}
        onOpenContents={() => onOpenSheet("contents")}
        onOpenSettings={() => onOpenSheet("settings")}
      />

      <ReaderContentsSheet
        isOpen={activeSheet === "contents"}
        onClose={onCloseSheet}
        onBack={() => onOpenSheet("tools")}
        toc={toc}
        chapterEntries={chapterEntries}
        chapterStartPages={chapterStartPages}
        currentChapterHref={currentChapterHref}
        currentChapterTitle={currentChapterTitle}
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

import { Separator } from "@/components/ui/separator";
import type {
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
} from "@/lib/pagination";
import type { ReaderSettings } from "@/types/reader.types";
import { DebugSection } from "./DebugSection";
import { NavigationSection } from "./NavigationSection";
import { SettingsSection } from "./SettingsSection";

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

export interface InspectorPanelProps {
  // Navigation
  currentPage: number;
  totalPages: number;
  paginationStatus: string;
  onGoToPage: (page: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  chapterEntries: ChapterEntry[];
  currentChapterIndex: number;
  chapterFirstPages: Map<number, number>;

  // Settings
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;

  // Viewport
  viewport: { width: number; height: number };
  onViewportChange: (v: { width: number; height: number }) => void;
  viewportAutoMode: boolean;
  onViewportAutoModeChange: (auto: boolean) => void;

  // Layout
  paragraphSpacingFactor: number;
  onParagraphSpacingFactorChange: (value: number) => void;

  // Debug
  diagnostics: PaginationDiagnostics | null;
  sourceLoadWallClockMs: number | null;
  addChapterSendWallClockMs: number | null;
  chapterTimingRows: PaginationChapterDiagnostics[];
}

export function InspectorPanel(props: InspectorPanelProps) {
  const chapterTitles = (index: number) =>
    props.chapterEntries[index]?.title ?? `Chapter ${index + 1}`;

  return (
    <div className="space-y-1 py-2">
      <NavigationSection
        currentPage={props.currentPage}
        totalPages={props.totalPages}
        paginationStatus={props.paginationStatus}
        onGoToPage={props.onGoToPage}
        onNextPage={props.onNextPage}
        onPrevPage={props.onPrevPage}
        chapterEntries={props.chapterEntries}
        currentChapterIndex={props.currentChapterIndex}
        chapterFirstPages={props.chapterFirstPages}
      />

      <Separator />

      <SettingsSection
        settings={props.settings}
        onUpdateSettings={props.onUpdateSettings}
        viewport={props.viewport}
        onViewportChange={props.onViewportChange}
        viewportAutoMode={props.viewportAutoMode}
        onViewportAutoModeChange={props.onViewportAutoModeChange}
        paragraphSpacingFactor={props.paragraphSpacingFactor}
        onParagraphSpacingFactorChange={props.onParagraphSpacingFactorChange}
      />

      <Separator />

      <DebugSection
        diagnostics={props.diagnostics}
        paginationStatus={props.paginationStatus}
        totalPages={props.totalPages}
        viewport={props.viewport}
        sourceLoadWallClockMs={props.sourceLoadWallClockMs}
        addChapterSendWallClockMs={props.addChapterSendWallClockMs}
        chapterTimingRows={props.chapterTimingRows}
        chapterTitles={chapterTitles}
      />
    </div>
  );
}

import { Separator } from "@/components/ui/separator";
import type { ReaderSettings } from "@/types/reader.types";
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
  onGoToChapterIndex: (chapterIndex: number) => void;
  onNextSpread: () => void;
  onPrevSpread: () => void;
  chapterEntries: ChapterEntry[];
  currentChapterIndex: number;

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
  spreadColumns?: 1 | 2 | 3;
  onSpreadColumnsChange?: (columns: 1 | 2 | 3) => void;
  columnSpacingPx?: number;
  onColumnSpacingPxChange?: (value: number) => void;
}

export function InspectorPanel(props: InspectorPanelProps) {
  const spreadColumns = props.spreadColumns ?? 1;
  const onSpreadColumnsChange = props.onSpreadColumnsChange ?? (() => {});
  const columnSpacingPx = props.columnSpacingPx ?? 16;
  const onColumnSpacingPxChange = props.onColumnSpacingPxChange ?? (() => {});

  return (
    <div className="space-y-1 py-2">
      <NavigationSection
        currentPage={props.currentPage}
        totalPages={props.totalPages}
        paginationStatus={props.paginationStatus}
        onGoToPage={props.onGoToPage}
        onGoToChapterIndex={props.onGoToChapterIndex}
        onNextSpread={props.onNextSpread}
        onPrevSpread={props.onPrevSpread}
        chapterEntries={props.chapterEntries}
        currentChapterIndex={props.currentChapterIndex}
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
        spreadColumns={spreadColumns}
        onSpreadColumnsChange={onSpreadColumnsChange}
        columnSpacingPx={columnSpacingPx}
        onColumnSpacingPxChange={onColumnSpacingPxChange}
      />
    </div>
  );
}

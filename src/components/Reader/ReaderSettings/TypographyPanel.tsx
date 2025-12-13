import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type {
  ContentWidth,
  FontFamily,
  ReaderSettings,
  TextAlign,
} from "@/types/reader.types";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
} from "lucide-react";
import { useEffect, useRef } from "react";

interface TypographyPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function TypographyPanel({
  settings,
  onUpdateSettings,
}: TypographyPanelProps) {
  const fonts: { value: FontFamily; label: string; stack: string }[] = [
    { value: "lora", label: "Lora", stack: '"Lora", serif' },
    {
      value: "iowan",
      label: "Iowan",
      stack: '"Iowan Old Style", "Sitka Text", Palatino, "Book Antiqua", serif',
    },
    {
      value: "garamond",
      label: "Garamond",
      stack: '"EB Garamond", "Garamond", serif',
    },
    { value: "inter", label: "Inter", stack: '"Inter", sans-serif' },
    {
      value: "monospace",
      label: "Mono",
      stack:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  ];

  const lineHeights = [1.2, 1.5, 1.8, 2.0];
  const contentWidths: { value: ContentWidth; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "narrow", label: "Narrow" },
    { value: "medium", label: "Medium" },
    { value: "wide", label: "Wide" },
    { value: "full", label: "Full" },
  ];
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const selectedElement =
        scrollContainerRef.current.querySelector('[data-state="on"]');
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: "instant",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Font Family */}
      <div className="space-y-2">
        <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
          Font Family
        </h4>
        <div
          ref={scrollContainerRef}
          className="flex gap-2 overflow-x-auto px-4 py-2 -mx-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {fonts.map((font) => {
            const isSelected = settings.fontFamily === font.value;
            return (
              <button
                key={font.value}
                data-state={isSelected ? "on" : "off"}
                onClick={() => onUpdateSettings({ fontFamily: font.value })}
                className={cn(
                  "flex flex-col items-center justify-center w-26 h-20 rounded-lg border-2 transition-all duration-200 ease-in-out flex-shrink-0 p-3 cursor-pointer active:scale-[0.98]",
                  isSelected
                    ? "border-primary bg-muted scale-105 shadow-sm"
                    : "border-transparent",
                )}
              >
                <span
                  className="text-xl mb-1"
                  style={{ fontFamily: font.stack }}
                >
                  Aa
                </span>
                <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide opacity-70">
                  {font.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Line Height */}
      <div className="space-y-2">
        <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
          Line Height
        </h4>
        <div className="flex items-center gap-2">
          <MoveVertical className="h-4 w-4 text-muted-foreground" />
          <ToggleGroup
            type="single"
            value={settings.lineHeight.toString()}
            onValueChange={(value) =>
              value && onUpdateSettings({ lineHeight: parseFloat(value) })
            }
            className="flex-1 h-12"
          >
            {lineHeights.map((lh) => (
              <ToggleGroupItem
                key={lh}
                value={lh.toString()}
                className="flex-1 text-xs h-full"
              >
                {lh}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Content Width */}
      <div className="space-y-2 hidden sm:block">
        <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
          Content Width
        </h4>
        <div className="flex items-center gap-2">
          <MoveHorizontal className="h-4 w-4 text-muted-foreground" />
          <ToggleGroup
            type="single"
            value={settings.contentWidth}
            onValueChange={(value) =>
              value && onUpdateSettings({ contentWidth: value as ContentWidth })
            }
            className="flex-1 h-12"
          >
            {contentWidths.map((width) => (
              <ToggleGroupItem
                key={width.value}
                value={width.value}
                className="flex-1 text-xs h-full"
              >
                {width.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Text Align */}
      <div className="space-y-2">
        <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
          Alignment
        </h4>
        <ToggleGroup
          type="single"
          value={settings.textAlign}
          onValueChange={(value) =>
            value && onUpdateSettings({ textAlign: value as TextAlign })
          }
          className="w-full h-12"
        >
          <ToggleGroupItem value="left" className="flex-1 text-xs h-full">
            <AlignLeft className="h-4 w-4 mr-2" />
            Left
          </ToggleGroupItem>
          <ToggleGroupItem value="center" className="flex-1 text-xs h-full">
            <AlignCenter className="h-4 w-4 mr-2" />
            Center
          </ToggleGroupItem>
          <ToggleGroupItem value="right" className="flex-1 text-xs h-full">
            <AlignRight className="h-4 w-4 mr-2" />
            Right
          </ToggleGroupItem>
          <ToggleGroupItem value="justify" className="flex-1 text-xs h-full">
            <AlignJustify className="h-4 w-4 mr-2" />
            Justify
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
          Font Size
        </h4>
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="rounded-md"
            onClick={() =>
              onUpdateSettings({
                fontSize: Math.max(50, settings.fontSize - 10),
              })
            }
            disabled={settings.fontSize <= 50}
          >
            <Minus className="h-4 w-4" />
            <span className="sr-only">Decrease font size</span>
          </Button>
          <span className="text-sm font-medium text-center tabular-nums min-w-[4rem]">
            {settings.fontSize}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="rounded-md"
            onClick={() =>
              onUpdateSettings({
                fontSize: Math.min(200, settings.fontSize + 10),
              })
            }
            disabled={settings.fontSize >= 200}
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">Increase font size</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { AnimatedNumber } from "@/components/ui/animated-number";
import { useEffect, useRef } from "react";

interface TypographyPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function TypographyPanel({
  settings,
  onUpdateSettings,
}: TypographyPanelProps) {
  const sectionLabelClassName =
    "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";
  const segmentedGroupClassName = "w-full rounded-full bg-secondary/40 p-1";
  const segmentedItemClassName =
    "h-9 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground";
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
    <div className="space-y-5 pb-2">
      {/* Font Family */}
      <div className="space-y-2.5">
        <h4 className={sectionLabelClassName}>
          Font Family
        </h4>
        <div
          ref={scrollContainerRef}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {fonts.map((font) => {
            const isSelected = settings.fontFamily === font.value;
            return (
              <button
                key={font.value}
                data-state={isSelected ? "on" : "off"}
                onClick={() => onUpdateSettings({ fontFamily: font.value })}
                className={cn(
                  "flex h-24 w-28 shrink-0 cursor-pointer flex-col justify-between rounded-[1.25rem] border px-3 py-3 text-left transition-colors active:scale-[0.98]",
                  isSelected
                    ? "border-border bg-background ring-1 ring-border/70"
                    : "border-border/40 bg-secondary/20 hover:bg-secondary/35",
                )}
              >
                <span
                  className="text-3xl leading-none text-foreground"
                  style={{ fontFamily: font.stack }}
                >
                  Aa
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {font.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Line Height */}
      <div className="space-y-2">
        <h4 className={sectionLabelClassName}>
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
            className={cn("flex-1", segmentedGroupClassName)}
          >
            {lineHeights.map((lh) => (
              <ToggleGroupItem
                key={lh}
                value={lh.toString()}
                className={cn("flex-1 text-xs", segmentedItemClassName)}
              >
                {lh}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Content Width */}
      <div className="space-y-2 hidden sm:block">
        <h4 className={sectionLabelClassName}>
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
            className={cn("flex-1", segmentedGroupClassName)}
          >
            {contentWidths.map((width) => (
              <ToggleGroupItem
                key={width.value}
                value={width.value}
                className={cn("flex-1 text-[10px]", segmentedItemClassName)}
              >
                {width.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Text Align */}
      <div className="space-y-2">
        <h4 className={sectionLabelClassName}>
          Alignment
        </h4>
        <ToggleGroup
          type="single"
          value={settings.textAlign}
          onValueChange={(value) =>
            value && onUpdateSettings({ textAlign: value as TextAlign })
          }
          className={segmentedGroupClassName}
        >
          <ToggleGroupItem
            value="left"
            className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
          >
            <AlignLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Left</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="center"
            className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
          >
            <AlignCenter className="h-4 w-4" />
            <span className="hidden sm:inline">Center</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="right"
            className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
          >
            <AlignRight className="h-4 w-4" />
            <span className="hidden sm:inline">Right</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="justify"
            className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
          >
            <AlignJustify className="h-4 w-4" />
            <span className="hidden sm:inline">Justify</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <h4 className={sectionLabelClassName}>
          Font Size
        </h4>
        <div className="flex items-center justify-between rounded-[1.25rem] border border-border/50 bg-secondary/20 px-3 py-3">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full border-border/60 bg-background/80 hover:bg-background"
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
          <span className="min-w-[4rem] text-center text-sm font-medium uppercase tracking-[0.12em] text-foreground tabular-nums">
            <AnimatedNumber
              value={settings.fontSize}
              format={(v) => `${Math.round(v)}%`}
            />
          </span>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full border-border/60 bg-background/80 hover:bg-background"
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

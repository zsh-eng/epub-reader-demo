import { Button } from "@/components/ui/button";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  isJustifiedTextAlign,
  READER_FONT_SIZE_MAX_PX,
  READER_FONT_SIZE_MIN_PX,
} from "@/types/reader.types";
import type {
  FontFamily,
  ReaderSettings,
  TextAlign,
} from "@/types/reader.types";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import { InspectorSection } from "./InspectorSection";

const fonts: { value: FontFamily; label: string; stack: string }[] = [
  { value: "lora", label: "Lora", stack: '"Lora", serif' },
  {
    value: "iowan",
    label: "Iowan",
    stack: '"Iowan Old Style", "Sitka Text", Palatino, serif',
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
    stack: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
];

interface SettingsSectionProps {
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  viewport: { width: number; height: number };
  onViewportChange: (v: { width: number; height: number }) => void;
  viewportAutoMode: boolean;
  onViewportAutoModeChange: (auto: boolean) => void;
  paragraphSpacingFactor: number;
  onParagraphSpacingFactorChange: (value: number) => void;
  spreadColumns: 1 | 2 | 3;
  onSpreadColumnsChange: (columns: 1 | 2 | 3) => void;
  columnSpacingPx: number;
  onColumnSpacingPxChange: (value: number) => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => {
          if (v !== undefined) onChange(v);
        }}
        disabled={disabled}
      />
    </div>
  );
}

export function SettingsSection({
  settings,
  onUpdateSettings,
  viewport,
  onViewportChange,
  viewportAutoMode,
  onViewportAutoModeChange,
  paragraphSpacingFactor,
  onParagraphSpacingFactorChange,
  spreadColumns,
  onSpreadColumnsChange,
  columnSpacingPx,
  onColumnSpacingPxChange,
}: SettingsSectionProps) {
  const alignmentValue = isJustifiedTextAlign(settings.textAlign)
    ? "justify"
    : settings.textAlign;
  const segmentedGroupClassName = "w-full rounded-lg bg-secondary/40 p-1";
  const segmentedItemClassName = "h-8 flex-1 rounded-md";

  return (
    <InspectorSection title="Reader Settings">
      <div className="space-y-4 pb-1">
        {/* Font family */}
        <div className="space-y-1.5">
          <span className="text-[11px] text-muted-foreground">Font</span>
          <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {fonts.map((font) => {
              const isSelected = settings.fontFamily === font.value;
              return (
                <button
                  key={font.value}
                  onClick={() => onUpdateSettings({ fontFamily: font.value })}
                  className={cn(
                    "flex flex-col items-center justify-center w-14 h-14 rounded-lg border transition-all duration-150 flex-shrink-0 cursor-pointer",
                    isSelected
                      ? "border-foreground/30 bg-muted"
                      : "border-transparent hover:bg-muted/50",
                  )}
                >
                  <span
                    className="text-base"
                    style={{ fontFamily: font.stack }}
                  >
                    Aa
                  </span>
                  <span className="text-[8px] text-muted-foreground uppercase tracking-wide mt-0.5">
                    {font.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font size */}
        <SliderRow
          label="Font Size"
          value={settings.fontSize}
          min={READER_FONT_SIZE_MIN_PX}
          max={READER_FONT_SIZE_MAX_PX}
          step={1}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) => onUpdateSettings({ fontSize: v })}
        />

        {/* Line height */}
        <SliderRow
          label="Line Height"
          value={settings.lineHeight}
          min={1.0}
          max={2.5}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) =>
            onUpdateSettings({ lineHeight: Math.round(v * 10) / 10 })
          }
        />

        {/* Text alignment */}
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Alignment</span>
          <SegmentedToggleGroup
            value={alignmentValue}
            onValueChange={(v) => {
              if (!v) return;
              onUpdateSettings({
                textAlign:
                  v === "justify"
                    ? "justify-knuth-plass"
                    : (v as Exclude<TextAlign, "justify-knuth-plass">),
              });
            }}
            className={segmentedGroupClassName}
          >
            <SegmentedToggleGroupItem
              value="left"
              className={segmentedItemClassName}
            >
              <AlignLeft className="size-3.5" />
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              value="center"
              className={segmentedItemClassName}
            >
              <AlignCenter className="size-3.5" />
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              value="right"
              className={segmentedItemClassName}
            >
              <AlignRight className="size-3.5" />
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              value="justify"
              className={segmentedItemClassName}
            >
              <AlignJustify className="size-3.5" />
            </SegmentedToggleGroupItem>
          </SegmentedToggleGroup>
        </div>

        {isJustifiedTextAlign(settings.textAlign) ? (
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">
              Justification
            </span>
            <SegmentedToggleGroup
              value={settings.textAlign}
              onValueChange={(value) => {
                if (value === "justify" || value === "justify-knuth-plass") {
                  onUpdateSettings({ textAlign: value });
                }
              }}
              className={segmentedGroupClassName}
            >
              <SegmentedToggleGroupItem
                value="justify"
                className={cn(segmentedItemClassName, "text-[11px]")}
              >
                Original
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem
                value="justify-knuth-plass"
                className={cn(segmentedItemClassName, "text-[11px]")}
              >
                Knuth-Plass
              </SegmentedToggleGroupItem>
            </SegmentedToggleGroup>
          </div>
        ) : null}

        {/* Content width */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Content Width
            </span>
            <Button
              variant={viewportAutoMode ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => onViewportAutoModeChange(!viewportAutoMode)}
            >
              Auto
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              min={240}
              max={1440}
              step={10}
              value={[viewport.width]}
              onValueChange={([v]) => {
                if (v !== undefined)
                  onViewportChange({ ...viewport, width: v });
              }}
              disabled={viewportAutoMode}
              className="flex-1"
            />
            <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-right">
              {Math.round(viewport.width)}
            </span>
          </div>
        </div>

        {/* Content height */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Content Height
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              min={300}
              max={980}
              step={10}
              value={[viewport.height]}
              onValueChange={([v]) => {
                if (v !== undefined)
                  onViewportChange({ ...viewport, height: v });
              }}
              disabled={viewportAutoMode}
              className="flex-1"
            />
            <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-right">
              {Math.round(viewport.height)}
            </span>
          </div>
        </div>

        {/* Paragraph spacing */}
        <SliderRow
          label="Paragraph Spacing"
          value={paragraphSpacingFactor}
          min={0.5}
          max={2.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) =>
            onParagraphSpacingFactorChange(Math.round(v * 10) / 10)
          }
        />
        <>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Columns</span>
            <SegmentedToggleGroup
              value={String(spreadColumns)}
              onValueChange={(value) => {
                if (value === "1" || value === "2" || value === "3") {
                  onSpreadColumnsChange(
                    Number.parseInt(value, 10) as 1 | 2 | 3,
                  );
                }
              }}
              className={segmentedGroupClassName}
            >
              <SegmentedToggleGroupItem
                value="1"
                className={segmentedItemClassName}
              >
                1
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem
                value="2"
                className={segmentedItemClassName}
              >
                2
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem
                value="3"
                className={segmentedItemClassName}
              >
                3
              </SegmentedToggleGroupItem>
            </SegmentedToggleGroup>
          </div>

          <SliderRow
            label="Column Spacing"
            value={columnSpacingPx}
            min={0}
            max={64}
            step={1}
            format={(v) => `${Math.round(v)}px`}
            onChange={(v) => onColumnSpacingPxChange(Math.round(v))}
          />
        </>
      </div>
    </InspectorSection>
  );
}

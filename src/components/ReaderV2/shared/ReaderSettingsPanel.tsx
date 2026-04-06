import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type {
  FontFamily,
  ReaderSettings,
  ReaderTheme,
} from "@/types/reader.types";
import { Check } from "lucide-react";

interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  showColumnSelector: boolean;
  spreadColumns: 1 | 2;
  onSpreadColumnsChange: (value: 1 | 2) => void;
}

const FONT_OPTIONS: { value: FontFamily; label: string; stack: string }[] = [
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
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
  },
];

const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "flexoki-light", label: "Flexoki Light" },
  { value: "flexoki-dark", label: "Flexoki Dark" },
];

export function ReaderSettingsPanel({
  settings,
  onUpdateSettings,
  showColumnSelector,
  spreadColumns,
  onSpreadColumnsChange,
}: ReaderSettingsPanelProps) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Font Family
        </h3>
        <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {FONT_OPTIONS.map((font) => {
            const isSelected = settings.fontFamily === font.value;

            return (
              <button
                key={font.value}
                onClick={() => onUpdateSettings({ fontFamily: font.value })}
                className={cn(
                  "w-18 h-16 shrink-0 rounded-lg border transition-colors",
                  "flex flex-col items-center justify-center gap-1",
                  isSelected
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/60",
                )}
              >
                <span className="text-lg leading-none" style={{ fontFamily: font.stack }}>
                  Aa
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {font.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Font Size
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(settings.fontSize)}%
          </span>
        </div>
        <Slider
          min={50}
          max={200}
          step={1}
          value={[settings.fontSize]}
          onValueChange={([value]) => {
            if (value !== undefined) {
              onUpdateSettings({ fontSize: Math.round(value) });
            }
          }}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Theme
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {THEME_OPTIONS.map((theme) => {
            const isSelected = settings.theme === theme.value;

            return (
              <button
                key={theme.value}
                onClick={() => onUpdateSettings({ theme: theme.value })}
                className={cn(
                  "h-9 rounded-md border px-3 text-xs",
                  "flex items-center justify-between transition-colors",
                  isSelected
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-accent/60",
                )}
              >
                <span>{theme.label}</span>
                {isSelected && <Check className="size-3.5" />}
              </button>
            );
          })}
        </div>
      </section>

      {showColumnSelector && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Columns
          </h3>
          <ToggleGroup
            type="single"
            value={String(spreadColumns)}
            onValueChange={(value) => {
              if (value === "1" || value === "2") {
                onSpreadColumnsChange(Number.parseInt(value, 10) as 1 | 2);
              }
            }}
            className="w-full"
          >
            <ToggleGroupItem value="1" className="h-9 flex-1">
              1
            </ToggleGroupItem>
            <ToggleGroupItem value="2" className="h-9 flex-1">
              2
            </ToggleGroupItem>
          </ToggleGroup>
        </section>
      )}
    </div>
  );
}

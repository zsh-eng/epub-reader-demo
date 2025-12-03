import { cn } from "@/lib/utils";
import type { ReaderSettings, ReaderTheme } from "@/types/reader.types";
import { Check } from "lucide-react";

interface ThemePanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

const SAMPLE_TEXT = "In a hole in the ground there lived a hobbit.";

interface ThemeConfig {
  value: ReaderTheme;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  checkClass: string;
}

const themes: ThemeConfig[] = [
  {
    value: "light",
    label: "Light",
    bgClass: "bg-white",
    textClass: "text-neutral-900",
    borderClass: "border-neutral-200",
    checkClass: "bg-neutral-900 text-white",
  },
  {
    value: "sepia",
    label: "Sepia",
    bgClass: "bg-[#f4ecd8]",
    textClass: "text-[#5c4b37]",
    borderClass: "border-[#e6dbbf]",
    checkClass: "bg-[#5c4b37] text-[#f4ecd8]",
  },
  {
    value: "dark",
    label: "Dark",
    bgClass: "bg-neutral-900",
    textClass: "text-neutral-100",
    borderClass: "border-neutral-700",
    checkClass: "bg-neutral-100 text-neutral-900",
  },
  {
    value: "flexoki-light",
    label: "Flexoki Light",
    bgClass: "bg-[#fffcf0]",
    textClass: "text-[#100f0f]",
    borderClass: "border-[#e6e4d9]",
    checkClass: "bg-[#100f0f] text-[#fffcf0]",
  },
  {
    value: "flexoki-dark",
    label: "Flexoki Dark",
    bgClass: "bg-[#100f0f]",
    textClass: "text-[#cecdc3]",
    borderClass: "border-[#282726]",
    checkClass: "bg-[#cecdc3] text-[#100f0f]",
  },
];

export function ThemePanel({ settings, onUpdateSettings }: ThemePanelProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
        Theme
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((theme) => {
          const isSelected = settings.theme === theme.value;
          return (
            <button
              key={theme.value}
              onClick={() => onUpdateSettings({ theme: theme.value })}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-lg border-2 transition-all duration-200 m-1",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "active:scale-[0.98]",
                theme.borderClass,
                isSelected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:border-muted-foreground/30",
              )}
            >
              {/* Preview area with sample text */}
              <div
                className={cn(
                  "px-3 py-4 text-left h-full",
                  theme.bgClass,
                  theme.textClass,
                )}
                style={{ fontFamily: settings.fontFamily }}
              >
                <p className="text-sm leading-relaxed line-clamp-2">
                  {SAMPLE_TEXT}
                </p>
              </div>

              {/* Label bar */}
              <div
                className={cn(
                  "flex items-center justify-between px-3 py-2",
                  theme.bgClass,
                  theme.textClass,
                  theme.borderClass,
                )}
              >
                <span className="text-tiny text-muted-foreground font-medium uppercase tracking-wide">
                  {theme.label}
                </span>
                {isSelected && (
                  <span
                    className={cn(
                      "flex items-center justify-center w-5 h-5 rounded-full",
                      theme.checkClass,
                    )}
                  >
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

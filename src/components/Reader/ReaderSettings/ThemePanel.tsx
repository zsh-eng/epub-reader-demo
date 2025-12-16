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
  themeClass: string;
}

const themes: ThemeConfig[] = [
  {
    value: "light",
    label: "Light",
    themeClass: "light",
  },
  {
    value: "dark",
    label: "Dark",
    themeClass: "dark",
  },
  {
    value: "flexoki-light",
    label: "Flexoki Light",
    themeClass: "flexoki-light",
  },
  {
    value: "flexoki-dark",
    label: "Flexoki Dark",
    themeClass: "flexoki-dark",
  },
];

export function ThemePanel({ settings, onUpdateSettings }: ThemePanelProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-muted-foreground text-tiny font-semibold uppercase tracking-wider dark:opacity-50 opacity-80">
        Theme
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((theme) => {
          const isSelected = settings.theme === theme.value;
          return (
            <button
              key={theme.value}
              onClick={() => onUpdateSettings({ theme: theme.value })}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-md border-2 transition-all duration-200 m-1 h-32",
                "ring-2 ring-offset-2 ring-offset-background",
                "focus:outline-none focus-visible:ring-ring",
                "active:scale-[0.98]",
                "border-border",
                isSelected ? "ring-primary" : "ring-transparent",
              )}
            >
              {/* Theme preview wrapper - applies the theme class */}
              <div className={cn("flex flex-col h-full", theme.themeClass)}>
                {/* Preview area with sample text */}
                <div
                  className="px-4 py-4 text-left flex-1 bg-background text-foreground"
                  style={{ fontFamily: settings.fontFamily }}
                >
                  <p className="text-sm leading-relaxed line-clamp-2">
                    {SAMPLE_TEXT}
                  </p>
                </div>

                {/* Label bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-background text-foreground border-t border-border">
                  <span className="text-tiny text-muted-foreground font-medium uppercase tracking-wide">
                    {theme.label}
                  </span>
                  {isSelected && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

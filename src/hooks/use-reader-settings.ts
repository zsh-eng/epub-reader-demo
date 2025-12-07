import { THEME_CLASSES, type ReaderSettings } from "@/types/reader.types";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "epub-reader-settings";

const DEFAULT_SETTINGS = {
  fontSize: 100,
  lineHeight: 1.5,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
} satisfies ReaderSettings;

export function useReaderSettings() {
  // Initialize state from localStorage or defaults
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;

    try {
      const item = window.localStorage.getItem(STORAGE_KEY);
      return item
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(item) }
        : DEFAULT_SETTINGS;
    } catch (error) {
      console.warn("Error reading settings from localStorage:", error);
      return DEFAULT_SETTINGS;
    }
  });

  // Update localStorage when settings change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

      // Manually handle theme switching since we removed next-themes
      const root = window.document.documentElement;
      root.classList.remove(...THEME_CLASSES);
      root.classList.add(settings.theme);
    } catch (error) {
      console.warn("Error saving settings to localStorage:", error);
    }
  }, [settings]);

  const updateSettings = useCallback((newSettings: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
  };
}

import {
  READER_FONT_SIZE_DEFAULT_PX,
  READER_FONT_SIZE_MAX_PX,
  READER_FONT_SIZE_MIN_PX,
  THEME_CLASSES,
  type ReaderSettings,
} from "@/types/reader.types";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "epub-reader-settings";
const THEME_TRANSITION_CLASS = "theme-transitioning";
const LEGACY_FONT_SIZE_BASE_PX = 16;

const DEFAULT_SETTINGS = {
  fontSize: READER_FONT_SIZE_DEFAULT_PX,
  lineHeight: 1.5,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
} satisfies ReaderSettings;

const THEME_TRANSITION_DURATION_MS = 300;

function clampFontSizePx(value: number): number {
  return Math.min(
    READER_FONT_SIZE_MAX_PX,
    Math.max(READER_FONT_SIZE_MIN_PX, value),
  );
}

// Older builds stored font size as a percentage of a 16px base.
// Normalize on read/update so saved preferences carry forward cleanly.
function normalizeFontSize(fontSize: unknown): number {
  if (typeof fontSize !== "number" || !Number.isFinite(fontSize)) {
    return READER_FONT_SIZE_DEFAULT_PX;
  }

  if (fontSize > READER_FONT_SIZE_MAX_PX) {
    return clampFontSizePx(
      Math.round((fontSize / 100) * LEGACY_FONT_SIZE_BASE_PX),
    );
  }

  return clampFontSizePx(Math.round(fontSize));
}

function normalizeReaderSettings(settings: ReaderSettings): ReaderSettings {
  return {
    ...settings,
    fontSize: normalizeFontSize(settings.fontSize),
  };
}

export function useReaderSettings() {
  // Track timeout for theme transition cleanup
  const themeTransitionTimeoutRef = useRef<number | null>(null);
  // Track if this is the initial mount - skip transitions on first load
  const isInitialMount = useRef(true);

  // Initialize state from localStorage or defaults
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;

    try {
      const item = window.localStorage.getItem(STORAGE_KEY);
      if (!item) {
        return DEFAULT_SETTINGS;
      }

      return normalizeReaderSettings({
        ...DEFAULT_SETTINGS,
        ...JSON.parse(item),
      });
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

      // Clear any existing timeout to ensure only the latest transition completes
      if (themeTransitionTimeoutRef.current !== null) {
        clearTimeout(themeTransitionTimeoutRef.current);
      }

      // Only add transition class after initial mount to avoid flash/stagger on page load
      // This is combined with the initial setting of the theme in index.html
      if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
      }
      // Add transitioning class for smooth theme change animation
      root.classList.add(THEME_TRANSITION_CLASS);
      // Remove transitioning class after transition completes
      themeTransitionTimeoutRef.current = window.setTimeout(() => {
        root.classList.remove(THEME_TRANSITION_CLASS);
        themeTransitionTimeoutRef.current = null;
      }, THEME_TRANSITION_DURATION_MS);

      root.classList.remove(...THEME_CLASSES);
      root.classList.add(settings.theme);
    } catch (error) {
      console.warn("Error saving settings to localStorage:", error);
    }

    // Cleanup: clear timeout if component unmounts
    return () => {
      if (themeTransitionTimeoutRef.current !== null) {
        clearTimeout(themeTransitionTimeoutRef.current);
      }
    };
  }, [settings]);

  const updateSettings = useCallback((newSettings: Partial<ReaderSettings>) => {
    setSettings((prev) => normalizeReaderSettings({ ...prev, ...newSettings }));
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

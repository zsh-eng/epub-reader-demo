import { useState, useEffect, useCallback } from 'react';
import type { ReaderSettings } from '@/types/reader.types';

const STORAGE_KEY = 'epub-reader-settings';

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 100,
  lineHeight: 1.5,
  fontFamily: 'serif',
  theme: 'light',
  textAlign: 'left',
};

export function useReaderSettings() {
  // Initialize state from localStorage or defaults
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    
    try {
      const item = window.localStorage.getItem(STORAGE_KEY);
      return item ? { ...DEFAULT_SETTINGS, ...JSON.parse(item) } : DEFAULT_SETTINGS;
    } catch (error) {
      console.warn('Error reading settings from localStorage:', error);
      return DEFAULT_SETTINGS;
    }
  });

  // Update localStorage when settings change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('Error saving settings to localStorage:', error);
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

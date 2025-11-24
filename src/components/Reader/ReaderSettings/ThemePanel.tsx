import { cn } from '@/lib/utils';
import type { ReaderSettings, ReaderTheme } from '@/types/reader.types';
import { Check } from 'lucide-react';

interface ThemePanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function ThemePanel({ settings, onUpdateSettings }: ThemePanelProps) {
  const themes: { value: ReaderTheme; label: string; color: string }[] = [
    { value: 'light', label: 'Light', color: 'bg-white border-gray-200' },
    { value: 'sepia', label: 'Sepia', color: 'bg-[#f4ecd8] border-[#e6dbbf]' },
    { value: 'dark', label: 'Dark', color: 'bg-gray-900 border-gray-800' },
    {
      value: 'flexoki-light',
      label: 'Flexoki Light',
      color: 'bg-[#fffcf0] border-[#cecdc3]',
    },
    {
      value: 'flexoki-dark',
      label: 'Flexoki Dark',
      color: 'bg-[#100f0f] border-[#282726]',
    },
  ];

  return (
    <div className='space-y-4'>
      <h4 className='text-muted-foreground text-xs font-semibold uppercase tracking-wider dark:opacity-50 opacity-80'>
        Theme
      </h4>
      <div className='grid grid-cols-5 gap-2'>
        {themes.map((theme) => (
          <button
            key={theme.value}
            className={cn(
              'w-8 h-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              theme.color,
              settings.theme === theme.value
                ? 'border-primary scale-110'
                : 'border-transparent hover:scale-105'
            )}
            onClick={() => onUpdateSettings({ theme: theme.value })}
            title={theme.label}
          >
            <span className='sr-only'>{theme.label}</span>
            {settings.theme === theme.value && (
              <Check
                className={cn(
                  'h-4 w-4 mx-auto',
                  theme.value.includes('dark') ? 'text-white' : 'text-black'
                )}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

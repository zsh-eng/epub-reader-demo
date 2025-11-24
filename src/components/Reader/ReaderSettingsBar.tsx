import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverAnchor,
    PopoverContent,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useScrollVisibility } from '@/hooks/use-scroll-visibility';
import { cn } from '@/lib/utils';
import type {
    FontFamily,
    ReaderSettings,
    ReaderTheme,
} from '@/types/reader.types';
import {
    AlignJustify,
    AlignLeft,
    Check,
    Minus,
    MoveVertical,
    Palette,
    Plus,
    Type,
} from 'lucide-react';
import { useRef, useState } from 'react';

interface ReaderSettingsBarProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

type Panel = 'theme' | 'typography' | null;

export function ReaderSettingsBar({
  settings,
  onUpdateSettings,
}: ReaderSettingsBarProps) {
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  const fonts: { value: FontFamily; label: string }[] = [
    { value: 'serif', label: 'Serif' },
    { value: 'sans-serif', label: 'Sans' },
    { value: 'monospace', label: 'Mono' },
  ];

  const lineHeights = [1.2, 1.5, 1.8, 2.0];
  const isVisible = useScrollVisibility();

  const handlePanelToggle = (panel: Panel) => {
    setActivePanel(activePanel === panel ? null : panel);
  };

  return (
    <div
      className={cn(
        'fixed bottom-0 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 pb-4',
        isVisible ? 'translate-y-0' : 'translate-y-[150%]'
      )}
    >
      <Popover
        open={activePanel !== null}
        onOpenChange={(open) => !open && setActivePanel(null)}
      >
        <PopoverAnchor>
          <div
            ref={menuRef}
            className='flex items-center gap-1 p-2 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-all hover:bg-background/95'
          >
            {/* Font Size Controls */}
            <div className='flex items-center gap-1'>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 rounded-full'
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.max(50, settings.fontSize - 10),
                  })
                }
                disabled={settings.fontSize <= 50}
              >
                <Minus className='h-4 w-4' />
                <span className='sr-only'>Decrease font size</span>
              </Button>
              <span className='text-xs font-medium w-8 text-center tabular-nums'>
                {settings.fontSize}%
              </span>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 rounded-full'
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.min(200, settings.fontSize + 10),
                  })
                }
                disabled={settings.fontSize >= 200}
              >
                <Plus className='h-4 w-4' />
                <span className='sr-only'>Increase font size</span>
              </Button>
            </div>

            <Separator orientation='vertical' className='h-6 mx-1' />

            {/* Theme Button */}
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'h-8 w-8 rounded-full',
                activePanel === 'theme' && 'bg-accent'
              )}
              onClick={() => handlePanelToggle('theme')}
            >
              <Palette className='h-4 w-4' />
              <span className='sr-only'>Theme</span>
            </Button>

            {/* Typography Button */}
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'h-8 w-8 rounded-full',
                activePanel === 'typography' && 'bg-accent'
              )}
              onClick={() => handlePanelToggle('typography')}
            >
              <Type className='h-4 w-4' />
              <span className='sr-only'>Typography</span>
            </Button>
          </div>
        </PopoverAnchor>

        <PopoverContent
          className='w-72 p-4 rounded-2xl bg-background/80 backdrop-blur-md border shadow-lg'
          alignOffset={20}
          onInteractOutside={(e) => {
            if (menuRef.current && menuRef.current.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          {activePanel === 'theme' && (
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
                          theme.value.includes('dark')
                            ? 'text-white'
                            : 'text-black'
                        )}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activePanel === 'typography' && (
            <div className='space-y-6'>
              {/* Font Family */}
              <div className='space-y-2'>
                <h4 className='text-muted-foreground text-xs font-semibold uppercase tracking-wider dark:opacity-50 opacity-80'>
                  Font Family
                </h4>
                <ToggleGroup
                  type='single'
                  value={settings.fontFamily}
                  onValueChange={(value) =>
                    value &&
                    onUpdateSettings({ fontFamily: value as FontFamily })
                  }
                  className='justify-start'
                >
                  {fonts.map((font) => (
                    <ToggleGroupItem
                      key={font.value}
                      value={font.value}
                      className='flex-1 text-xs'
                    >
                      {font.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Line Height */}
              <div className='space-y-2'>
                <h4 className='text-muted-foreground text-xs font-semibold uppercase tracking-wider dark:opacity-50 opacity-80'>
                  Line Height
                </h4>
                <div className='flex items-center gap-2'>
                  <MoveVertical className='h-4 w-4 text-muted-foreground' />
                  <ToggleGroup
                    type='single'
                    value={settings.lineHeight.toString()}
                    onValueChange={(value) =>
                      value &&
                      onUpdateSettings({ lineHeight: parseFloat(value) })
                    }
                    className='flex-1'
                  >
                    {lineHeights.map((lh) => (
                      <ToggleGroupItem
                        key={lh}
                        value={lh.toString()}
                        className='flex-1 text-xs'
                      >
                        {lh}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>

              {/* Text Align */}
              <div className='space-y-2'>
                <h4 className='text-muted-foreground text-xs font-semibold uppercase tracking-wider dark:opacity-50 opacity-80'>
                  Alignment
                </h4>
                <ToggleGroup
                  type='single'
                  value={settings.textAlign}
                  onValueChange={(value) =>
                    value &&
                    onUpdateSettings({ textAlign: value as 'left' | 'justify' })
                  }
                  className='justify-start'
                >
                  <ToggleGroupItem value='left' className='flex-1'>
                    <AlignLeft className='h-4 w-4 mr-2' />
                    Left
                  </ToggleGroupItem>
                  <ToggleGroupItem value='justify' className='flex-1'>
                    <AlignJustify className='h-4 w-4 mr-2' />
                    Justify
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

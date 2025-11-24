import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { FontFamily, ReaderSettings } from '@/types/reader.types';
import { AlignJustify, AlignLeft, MoveVertical } from 'lucide-react';

interface TypographyPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function TypographyPanel({
  settings,
  onUpdateSettings,
}: TypographyPanelProps) {
  const fonts: { value: FontFamily; label: string }[] = [
    { value: 'serif', label: 'Serif' },
    { value: 'sans-serif', label: 'Sans' },
    { value: 'monospace', label: 'Mono' },
  ];

  const lineHeights = [1.2, 1.5, 1.8, 2.0];

  return (
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
            value && onUpdateSettings({ fontFamily: value as FontFamily })
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
              value && onUpdateSettings({ lineHeight: parseFloat(value) })
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
  );
}

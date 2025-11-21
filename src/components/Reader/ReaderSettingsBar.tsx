import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlignJustify,
  AlignLeft,
  Minus,
  Plus,
  Type,
  Palette,
  MoveVertical,
  Check,
} from 'lucide-react';
import type { ReaderSettings, ReaderTheme, FontFamily } from '@/types/reader.types';
import { cn } from '@/lib/utils';

interface ReaderSettingsBarProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function ReaderSettingsBar({
  settings,
  onUpdateSettings,
}: ReaderSettingsBarProps) {
  const themes: { value: ReaderTheme; label: string; color: string }[] = [
    { value: 'light', label: 'Light', color: 'bg-white border-gray-200' },
    { value: 'sepia', label: 'Sepia', color: 'bg-[#f4ecd8] border-[#e6dbbf]' },
    { value: 'dark', label: 'Dark', color: 'bg-gray-900 border-gray-800' },
    { value: 'flexoki-light', label: 'Flexoki Light', color: 'bg-[#fffcf0] border-[#cecdc3]' },
    { value: 'flexoki-dark', label: 'Flexoki Dark', color: 'bg-[#100f0f] border-[#282726]' },
  ];

  const fonts: { value: FontFamily; label: string }[] = [
    { value: 'serif', label: 'Serif' },
    { value: 'sans-serif', label: 'Sans' },
    { value: 'monospace', label: 'Mono' },
  ];

  const lineHeights = [1.2, 1.5, 1.8, 2.0];

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-2 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-all hover:bg-background/95">
        
        {/* Font Size Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onUpdateSettings({ fontSize: Math.max(50, settings.fontSize - 10) })}
            disabled={settings.fontSize <= 50}
          >
            <Minus className="h-4 w-4" />
            <span className="sr-only">Decrease font size</span>
          </Button>
          <span className="text-xs font-medium w-8 text-center tabular-nums">
            {settings.fontSize}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onUpdateSettings({ fontSize: Math.min(200, settings.fontSize + 10) })}
            disabled={settings.fontSize >= 200}
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">Increase font size</span>
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Theme Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
              <Palette className="h-4 w-4" />
              <span className="sr-only">Theme</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-4 mb-2" sideOffset={10}>
            <div className="space-y-4">
              <h4 className="font-medium leading-none text-sm text-muted-foreground">Theme</h4>
              <div className="grid grid-cols-5 gap-2">
                {themes.map((theme) => (
                  <button
                    key={theme.value}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      theme.color,
                      settings.theme === theme.value ? "border-primary scale-110" : "border-transparent hover:scale-105"
                    )}
                    onClick={() => onUpdateSettings({ theme: theme.value })}
                    title={theme.label}
                  >
                    <span className="sr-only">{theme.label}</span>
                    {settings.theme === theme.value && (
                      <Check className={cn(
                        "h-4 w-4 mx-auto", 
                        theme.value.includes('dark') ? "text-white" : "text-black"
                      )} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Typography Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
              <Type className="h-4 w-4" />
              <span className="sr-only">Typography</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-4 mb-2" sideOffset={10}>
            <div className="space-y-6">
              
              {/* Font Family */}
              <div className="space-y-2">
                <h4 className="font-medium leading-none text-sm text-muted-foreground">Font Family</h4>
                <ToggleGroup 
                  type="single" 
                  value={settings.fontFamily} 
                  onValueChange={(value) => value && onUpdateSettings({ fontFamily: value as FontFamily })}
                  className="justify-start"
                >
                  {fonts.map((font) => (
                    <ToggleGroupItem key={font.value} value={font.value} className="flex-1 text-xs">
                      {font.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Line Height */}
              <div className="space-y-2">
                <h4 className="font-medium leading-none text-sm text-muted-foreground">Line Height</h4>
                <div className="flex items-center gap-2">
                  <MoveVertical className="h-4 w-4 text-muted-foreground" />
                  <ToggleGroup 
                    type="single" 
                    value={settings.lineHeight.toString()} 
                    onValueChange={(value) => value && onUpdateSettings({ lineHeight: parseFloat(value) })}
                    className="flex-1"
                  >
                    {lineHeights.map((lh) => (
                      <ToggleGroupItem key={lh} value={lh.toString()} className="flex-1 text-xs">
                        {lh}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>

              {/* Text Align */}
              <div className="space-y-2">
                <h4 className="font-medium leading-none text-sm text-muted-foreground">Alignment</h4>
                <ToggleGroup 
                  type="single" 
                  value={settings.textAlign} 
                  onValueChange={(value) => value && onUpdateSettings({ textAlign: value as 'left' | 'justify' })}
                  className="justify-start"
                >
                  <ToggleGroupItem value="left" className="flex-1">
                    <AlignLeft className="h-4 w-4 mr-2" />
                    Left
                  </ToggleGroupItem>
                  <ToggleGroupItem value="justify" className="flex-1">
                    <AlignJustify className="h-4 w-4 mr-2" />
                    Justify
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

            </div>
          </PopoverContent>
        </Popover>

      </div>
    </div>
  );
}

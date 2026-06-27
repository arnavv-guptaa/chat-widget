'use client';

import { Button } from '../ui/button';
import { useChatTheme } from '../hooks/use-chat-theme';
import { RotateCcw, Check } from 'lucide-react';

// Preset accent colors shown as swatches. These map onto the hook's
// primary color (`lightPrimary` / `darkPrimary`) — the color used for
// buttons, user messages and accents — for the currently active theme mode.
const colorPalettes = [
  { name: 'Blue', accentColor: '#3b82f6' },
  { name: 'Purple', accentColor: '#8b5cf6' },
  { name: 'Green', accentColor: '#22c55e' },
  { name: 'Amber', accentColor: '#f59e0b' },
  { name: 'Red', accentColor: '#ef4444' },
  { name: 'Pink', accentColor: '#ec4899' },
  { name: 'Cyan', accentColor: '#06b6d4' },
  { name: 'Slate', accentColor: '#64748b' },
];

export function AppearanceSettings() {
  const { theme, updateLightColors, updateDarkColors, resetTheme, themeMode } = useChatTheme();

  // The "accent" color is the primary color for the active theme mode.
  const accentColor = themeMode === 'light' ? theme.lightPrimary : theme.darkPrimary;

  const setAccentColor = (color: string) => {
    if (themeMode === 'light') {
      updateLightColors({ primary: color });
    } else {
      updateDarkColors({ primary: color });
    }
  };

  const isActivePalette = (paletteIndex: number) => {
    const palette = colorPalettes[paletteIndex];
    return accentColor.toLowerCase() === palette.accentColor.toLowerCase();
  };

  return (
    <div className="space-y-5">
      {/* Appearance Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Appearance
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetTheme}
            className="h-7 px-2.5 text-xs font-medium rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2} />
          </Button>
        </div>

        {/* Compact Color Grid */}
        <div className="flex flex-wrap gap-2">
          {colorPalettes.map((palette, index) => (
            <button
              key={index}
              onClick={() => setAccentColor(palette.accentColor)}
              className="relative group focus:outline-none"
              title={palette.name}
            >
              <div
                className={`w-10 h-10 rounded-full transition-all duration-200 ${
                  isActivePalette(index)
                    ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 shadow-md scale-100'
                    : 'shadow-sm hover:shadow-md hover:scale-105'
                }`}
                style={{ backgroundColor: palette.accentColor }}
              >
                {/* Active indicator */}
                {isActivePalette(index) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full bg-white dark:bg-gray-50 flex items-center justify-center shadow-sm">
                      <Check
                        className="h-3 w-3"
                        style={{ color: palette.accentColor }}
                        strokeWidth={3}
                      />
                    </div>
                  </div>
                )}
              </div>
            </button>
          ))}

          {/* Custom color picker inline */}
          <div className="relative group" title="Custom Color">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="w-10 h-10 rounded-full cursor-pointer border-2 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-all duration-200 hover:shadow-md hover:scale-105"
            />
          </div>
        </div>

        {/* Compact hex input */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">HEX:</span>
          <input
            type="text"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="flex-1 h-8 px-3 text-xs font-mono font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 focus:border-gray-300 dark:focus:border-gray-600 focus:bg-white dark:focus:bg-gray-900 transition-all duration-200 outline-none"
            placeholder="#3b82f6"
          />
        </div>
      </div>

      {/* Divider for future sections */}
      <div className="border-t border-gray-200/60 dark:border-gray-700/60" />

      {/* Placeholder for future settings */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          More Settings
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Additional customization options coming soon...
        </p>
      </div>
    </div>
  );
}

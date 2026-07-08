import type { ThemeConfig } from './types';

export interface ThemePreset extends ThemeConfig {
  /** Display name shown in the playground preset picker. */
  name: string;
}

/**
 * Canonical preset themes. The playground renders its preset picker from this
 * list so the widget package stays the single source of truth for what a
 * "good" three-color combination looks like. Every preset is just a valid
 * ThemeConfig — there is nothing a preset can do that a hand-picked trio
 * can't.
 */
export const THEME_PRESETS: ThemePreset[] = [
  // Matches the stock palette (same result as omitting `theme`).
  { name: 'Light', backgroundColor: '#ffffff', textColor: '#262626', primaryColor: '#171717' },
  { name: 'Dark', backgroundColor: '#171717', textColor: '#ededed', primaryColor: '#fafafa' },
  { name: 'Midnight', backgroundColor: '#0f172a', textColor: '#e2e8f0', primaryColor: '#60a5fa' },
  { name: 'Cream', backgroundColor: '#faf7f0', textColor: '#3f3a33', primaryColor: '#b45309' },
  { name: 'Forest', backgroundColor: '#0c1a14', textColor: '#d7e5dc', primaryColor: '#34d399' },
  { name: 'Ocean', backgroundColor: '#f0f7fa', textColor: '#1e3a45', primaryColor: '#0369a1' },
];

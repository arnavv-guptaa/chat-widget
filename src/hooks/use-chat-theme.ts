import { useState, useEffect } from 'react';
import { MODELS } from '../utils/models';
import { useChatStorageKey } from '../contexts/chat-storage-context';

// Helper function to convert HEX to HSL format that Tailwind expects
// Tailwind expects HSL in format: "0 0% 0%" (no hsl() wrapper, space-separated)
function hexToHSL(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '');

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  // Convert to Tailwind format: "hue saturation% lightness%"
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export interface ChatTheme {
  // Light mode colors
  lightPrimary: string;     // Primary color (buttons, user messages, accents)
  lightSecondary: string;   // Secondary color (backgrounds, surfaces)
  lightText: string;        // Text color

  // Dark mode colors
  darkPrimary: string;      // Primary color in dark mode
  darkSecondary: string;    // Secondary color in dark mode
  darkText: string;         // Text color in dark mode

  // Typography
  fontFamily: string;       // Font family for chat text
  fontSize: number;         // Font size in pixels (12-18)
}

export type ThemeMode = 'light' | 'dark';

export interface ConversationStarter {
  text: string;
  enabled: boolean;
}

// Default theme with sensible light and dark mode colors
const defaultTheme: ChatTheme = {
  // Light mode
  lightPrimary: '#3b82f6',      // Blue
  lightSecondary: '#f5f5f5',    // Light gray
  lightText: '#0a0a0a',         // Near black

  // Dark mode
  darkPrimary: '#3b82f6',       // Blue (same as light)
  darkSecondary: '#262626',     // Dark gray
  darkText: '#ffffff',          // White

  // Typography
  fontFamily: 'system-ui',
  fontSize: 14,
};

// Font options
export const fontOptions = [
  { value: 'system-ui', label: 'System Default' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: 'Open Sans, sans-serif', label: 'Open Sans' },
  { value: 'Lato, sans-serif', label: 'Lato' },
  { value: 'Poppins, sans-serif', label: 'Poppins' },
  { value: 'Montserrat, sans-serif', label: 'Montserrat' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'ui-monospace, monospace', label: 'Monospace' },
];
const defaultConversationStarters: ConversationStarter[] = [
  { text: 'How can I help you today?', enabled: true },
  { text: 'What features does this product offer?', enabled: true },
  { text: 'Tell me about your capabilities', enabled: true },
];
// The chat UI's model-picker shows this first; it's a local dropdown default,
// not a system-wide "default model" (the server requires an explicit choice).
const defaultModel = MODELS[0].value;
const defaultSystemPrompt = 'You are a helpful AI assistant.';
const defaultTemperature = 0.7;
const defaultThemeMode: ThemeMode = 'light';

export function useChatTheme() {
  // Scoped to (agent, user). `null` when identity is incomplete — in that case
  // we neither read nor write localStorage (no shared/static bucket → no leak).
  const { storageKeyPrefix } = useChatStorageKey();
  const keyPrefix = storageKeyPrefix ? `chat-${storageKeyPrefix}-` : null;

  const [theme, setTheme] = useState<ChatTheme>(defaultTheme);
  const [conversationStarters, setConversationStarters] = useState<ConversationStarter[]>(defaultConversationStarters);
  const [model, setModel] = useState<string>(defaultModel);
  const [systemPrompt, setSystemPrompt] = useState<string>(defaultSystemPrompt);
  const [temperature, setTemperature] = useState<number>(defaultTemperature);
  const [themeMode, setThemeMode] = useState<ThemeMode>(defaultThemeMode);

  // Load theme from localStorage on mount
  useEffect(() => {
    // Without a complete (agent, user) identity, do not read any cached config.
    if (!keyPrefix) return;
    const savedTheme = localStorage.getItem(`${keyPrefix}theme`);
    if (savedTheme) {
      try {
        setTheme(JSON.parse(savedTheme));
      } catch (error) {
        console.error('Error loading theme:', error);
      }
    }

    const savedStarters = localStorage.getItem(`${keyPrefix}conversation-starters`);
    if (savedStarters) {
      try {
        setConversationStarters(JSON.parse(savedStarters));
      } catch (error) {
        console.error('Error loading conversation starters:', error);
      }
    }

    const savedModel = localStorage.getItem(`${keyPrefix}model`);
    if (savedModel) {
      try {
        setModel(savedModel);
      } catch (error) {
        console.error('Error loading model:', error);
      }
    }

    const savedSystemPrompt = localStorage.getItem(`${keyPrefix}system-prompt`);
    if (savedSystemPrompt) {
      try {
        setSystemPrompt(savedSystemPrompt);
      } catch (error) {
        console.error('Error loading system prompt:', error);
      }
    }

    const savedTemperature = localStorage.getItem(`${keyPrefix}temperature`);
    if (savedTemperature) {
      try {
        setTemperature(parseFloat(savedTemperature));
      } catch (error) {
        console.error('Error loading temperature:', error);
      }
    }

    const savedThemeMode = localStorage.getItem(`${keyPrefix}theme-mode`);
    if (savedThemeMode) {
      try {
        setThemeMode(savedThemeMode as ThemeMode);
      } catch (error) {
        console.error('Error loading theme mode:', error);
      }
    }

    // Listen for changes from other components (same page via custom events)
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTheme(customEvent.detail);
    };

    const handleStartersChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setConversationStarters(customEvent.detail);
    };

    const handleSystemPromptChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setSystemPrompt(customEvent.detail);
    };

    const handleModelChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setModel(customEvent.detail);
    };

    const handleTemperatureChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTemperature(customEvent.detail);
    };

    const handleThemeModeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setThemeMode(customEvent.detail);
    };

    window.addEventListener('chat-theme-change', handleThemeChange);
    window.addEventListener('chat-starters-change', handleStartersChange);
    window.addEventListener('chat-model-change', handleModelChange);
    window.addEventListener('chat-system-prompt-change', handleSystemPromptChange);
    window.addEventListener('chat-temperature-change', handleTemperatureChange);
    window.addEventListener('chat-theme-mode-change', handleThemeModeChange);

    return () => {
      window.removeEventListener('chat-theme-change', handleThemeChange);
      window.removeEventListener('chat-starters-change', handleStartersChange);
      window.removeEventListener('chat-model-change', handleModelChange);
      window.removeEventListener('chat-system-prompt-change', handleSystemPromptChange);
      window.removeEventListener('chat-temperature-change', handleTemperatureChange);
      window.removeEventListener('chat-theme-mode-change', handleThemeModeChange);
    };
  }, [keyPrefix]);

  // Save theme to localStorage whenever it changes
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}theme`, JSON.stringify(theme));

    // Apply CSS variables to the document (always — purely cosmetic, not persisted)
    const root = document.documentElement;

    // Apply the appropriate colors based on theme mode
    // Convert HEX to HSL format that Tailwind expects
    if (themeMode === 'light') {
      root.style.setProperty('--chat-primary', hexToHSL(theme.lightPrimary));
      root.style.setProperty('--chat-secondary', hexToHSL(theme.lightSecondary));
      root.style.setProperty('--chat-text', hexToHSL(theme.lightText));
    } else {
      root.style.setProperty('--chat-primary', hexToHSL(theme.darkPrimary));
      root.style.setProperty('--chat-secondary', hexToHSL(theme.darkSecondary));
      root.style.setProperty('--chat-text', hexToHSL(theme.darkText));
    }

    // Typography (same for both modes)
    root.style.setProperty('--chat-font-family', theme.fontFamily);
    root.style.setProperty('--chat-font-size', `${theme.fontSize}px`);

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-theme-change', { detail: theme }));
  }, [theme, themeMode, keyPrefix]);

  // Save conversation starters to localStorage whenever they change
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}conversation-starters`, JSON.stringify(conversationStarters));

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-starters-change', { detail: conversationStarters }));
  }, [conversationStarters, keyPrefix]);

  // Save model to localStorage whenever it changes
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}model`, model);

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-model-change', { detail: model }));
  }, [model, keyPrefix]);

  // Save system prompt to localStorage whenever it changes
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}system-prompt`, systemPrompt);

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-system-prompt-change', { detail: systemPrompt }));
  }, [systemPrompt, keyPrefix]);

  // Save temperature to localStorage whenever it changes
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}temperature`, temperature.toString());

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-temperature-change', { detail: temperature }));
  }, [temperature, keyPrefix]);

  // Save theme mode to localStorage whenever it changes
  useEffect(() => {
    if (keyPrefix) localStorage.setItem(`${keyPrefix}theme-mode`, themeMode);

    // Dispatch custom event for same-page sync
    window.dispatchEvent(new CustomEvent('chat-theme-mode-change', { detail: themeMode }));
  }, [themeMode, keyPrefix]);

  const updateColor = (key: keyof ChatTheme, value: string | number) => {
    setTheme(prev => ({ ...prev, [key]: value }));
  };

  const updateLightColors = (colors: { primary?: string; secondary?: string; text?: string }) => {
    setTheme(prev => ({
      ...prev,
      ...(colors.primary && { lightPrimary: colors.primary }),
      ...(colors.secondary && { lightSecondary: colors.secondary }),
      ...(colors.text && { lightText: colors.text }),
    }));
  };

  const updateDarkColors = (colors: { primary?: string; secondary?: string; text?: string }) => {
    setTheme(prev => ({
      ...prev,
      ...(colors.primary && { darkPrimary: colors.primary }),
      ...(colors.secondary && { darkSecondary: colors.secondary }),
      ...(colors.text && { darkText: colors.text }),
    }));
  };

  const resetTheme = () => {
    setTheme(defaultTheme);
  };

  const updateFontSize = (size: number) => {
    setTheme(prev => ({ ...prev, fontSize: size }));
  };

  const updateFontFamily = (family: string) => {
    setTheme(prev => ({ ...prev, fontFamily: family }));
  };

  const updateConversationStarters = (starters: ConversationStarter[]) => {
    setConversationStarters(starters);
  };

  const updateSystemPrompt = (prompt: string) => {
    setSystemPrompt(prompt);
  };

  const updateModel = (selectedModel: string) => {
    setModel(selectedModel);
  };

  const updateTemperature = (temp: number) => {
    setTemperature(temp);
  };

  const updateThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  return {
    theme,
    updateColor,
    updateLightColors,
    updateDarkColors,
    resetTheme,
    updateFontSize,
    updateFontFamily,
    conversationStarters,
    updateConversationStarters,
    model,
    updateModel,
    systemPrompt,
    updateSystemPrompt,
    temperature,
    updateTemperature,
    themeMode,
    updateThemeMode,
  };
}

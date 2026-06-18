/**
 * Convert a `#rrggbb` hex color into the space-separated HSL triplet format
 * the widget's CSS variables consume (e.g. `"215 20% 25%"` — used inside
 * `hsl(var(--chat-primary))`). Non-hex inputs (named, rgb(), already-triplet)
 * are returned unchanged so callers can opt out by passing a triplet directly.
 *
 * Kept tiny on purpose: this is the only place hex/rgb conversion happens at
 * runtime. The widget's settings panel has its own copy in use-chat-theme.ts
 * because that path runs before ChatWidget mounts.
 */
export function toHslTripletIfHex(value: string): string {
  const trimmed = value.trim();
  const hexMatch = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(trimmed);
  if (!hexMatch) return value;

  let hex = hexMatch[1];
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
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

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

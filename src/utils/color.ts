/**
 * Convert a `#rgb` / `#rrggbb` hex color into the space-separated HSL triplet
 * the widget's CSS variables consume (e.g. `"215 20% 25%"` — used inside
 * `hsl(var(--chat-primary))`). Returns `null` for anything that is not a
 * valid hex color: theming accepts hex ONLY, and callers must skip invalid
 * values so user typos can never produce broken CSS.
 */
export function hexToHslTriplet(value: string): string | null {
  // Guard non-string input (e.g. a partial theme object with a missing color):
  // the contract is "return null for anything not a valid hex", and a crash on
  // `undefined.trim()` would break the whole widget render.
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(trimmed);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(h * 360)} ${round(sat * 100)}% ${round(l * 100)}%`;
}

/**
 * WCAG relative luminance of a hex color (0..1), or `null` for anything that
 * is not valid hex. This — not HSL lightness — is the right input for "which
 * text color is readable on this background": HSL lightness is not
 * perceptual (pure yellow is L=50% but relative luminance ≈0.89, so white
 * text on yellow is unreadable even though an "L < 60 → light text"
 * heuristic approves it).
 */
export function hexRelativeLuminance(value: string): number | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const linear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  const r = linear(parseInt(hex.substring(0, 2), 16));
  const g = linear(parseInt(hex.substring(2, 4), 16));
  const b = linear(parseInt(hex.substring(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The near-black or near-white HSL triplet that reads best ON the given hex
 * color — the classic "text on brand" picker (used for the send button, the
 * launcher icon, and user-bubble text, all painted over --chat-primary).
 * 0.179 is the luminance at which white and black text have EQUAL WCAG
 * contrast against the color; above it, dark text wins. Returns `null` for
 * invalid hex — callers skip, and the CSS falls back to the stock palette.
 */
export function contrastForegroundTriplet(value: string): string | null {
  const luminance = hexRelativeLuminance(value);
  if (luminance === null) return null;
  return luminance > 0.179 ? '0 0% 10%' : '0 0% 98%';
}

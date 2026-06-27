// URL/HTML safety helpers for model- and user-controlled values.
//
// Attachment filenames and URLs (and citation links) originate from the AI
// message stream, so they are untrusted. These helpers enforce a strict
// protocol allowlist and HTML-escape any text that must be interpolated into
// markup, preventing DOM-based XSS (e.g. `javascript:` hrefs or `<script>` in
// a filename).

// Protocols we consider safe to navigate to or load directly.
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

// Inline image types allowed for `data:` image URLs (used by image previews).
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon)(;[\w=.+-]+)*,/i;

/**
 * Returns the URL if it uses a safe scheme, otherwise `undefined`.
 *
 * Allows http(s)/mailto/tel and `blob:` URLs (same-origin, created locally),
 * plus inline `data:` image URLs. Everything else — notably `javascript:`,
 * `vbscript:`, `file:` and unknown schemes — is rejected. Relative URLs are
 * permitted since they cannot carry a dangerous scheme.
 */
export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed === "") return undefined;

  // Inline data: images are allowed only for known image media types.
  if (/^data:/i.test(trimmed)) {
    return SAFE_DATA_IMAGE_RE.test(trimmed) ? trimmed : undefined;
  }

  // blob: URLs are created by the app itself (same origin) and are safe.
  if (/^blob:/i.test(trimmed)) return trimmed;

  // Relative URLs (no scheme) can't smuggle in javascript:/vbscript:.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;

  try {
    // Resolve against the current origin to normalize and read the protocol.
    const base =
      typeof window !== "undefined" ? window.location.href : "http://localhost";
    const parsed = new URL(trimmed, base);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** True when the URL is an allowed inline `data:` image. */
export function isSafeDataImage(url: string | undefined | null): boolean {
  return !!url && SAFE_DATA_IMAGE_RE.test(url.trim());
}

/** HTML-escape a string for safe interpolation into markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

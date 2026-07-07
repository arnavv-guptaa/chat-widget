import { describe, it, expect } from 'vitest';
import { safeUrl, isSafeDataImage, escapeHtml } from '../src/utils/url-safety';

// The XSS boundary: attachment/citation/link URLs originate from the AI message
// stream and are untrusted. `safeUrl` must strip anything that could execute on
// click or load; `escapeHtml` must neutralise markup.
describe('safeUrl — protocol allowlist', () => {
  it('allows http/https/mailto/tel unchanged', () => {
    expect(safeUrl('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('rejects script-bearing / dangerous schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('JavaScript:alert(1)')).toBeUndefined();
    expect(safeUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeUrl('file:///etc/passwd')).toBeUndefined();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('allows inline data: images but not other data: payloads', () => {
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeUrl('data:image/svg+xml,<svg></svg>')).toBe('data:image/svg+xml,<svg></svg>');
    expect(safeUrl('data:application/pdf;base64,AAAA')).toBeUndefined();
  });

  it('allows blob: and relative URLs (cannot carry a scheme)', () => {
    expect(safeUrl('blob:https://example.com/uuid')).toBe('blob:https://example.com/uuid');
    expect(safeUrl('/relative/path')).toBe('/relative/path');
    expect(safeUrl('./x')).toBe('./x');
  });

  it('treats empty / whitespace / nullish as no URL', () => {
    expect(safeUrl('')).toBeUndefined();
    expect(safeUrl('   ')).toBeUndefined();
    expect(safeUrl(null)).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
  });
});

describe('isSafeDataImage', () => {
  it('accepts allowed inline image types only', () => {
    expect(isSafeDataImage('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeDataImage('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isSafeDataImage('data:text/html,<b>')).toBe(false);
    expect(isSafeDataImage('https://x/y.png')).toBe(false);
    expect(isSafeDataImage(null)).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes the markup-significant characters', () => {
    expect(escapeHtml('<script>a & "b" \'c\'</script>')).toBe(
      '&lt;script&gt;a &amp; &quot;b&quot; &#39;c&#39;&lt;/script&gt;',
    );
  });
});

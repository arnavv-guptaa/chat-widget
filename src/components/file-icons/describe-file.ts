import type { ComponentType } from 'react';
import { FileText } from 'lucide-react';
import { getFileIconByExtension } from './file-icon-map';

/**
 * One shared "what does this file look like" helper for every attachment chip
 * (composer chips + message attachments — previously two byte-identical copies
 * with generic lucide glyphs). The icon comes from the ported brand-icon map
 * (real Python/TS/React/PDF/Excel glyphs); the label stays a short uppercase
 * hint so the chip always says something even for unknown types.
 */
export function describeFile(file: { filename?: string; mediaType?: string }): {
  Icon: ComponentType<{ className?: string }>;
  label: string;
} {
  const filename = file.filename || '';
  const mt = (file.mediaType || '').toLowerCase();
  const ext = filename.toLowerCase().split('.').pop() || '';

  // Extension-based brand icon first — it covers code, docs, sheets, slides,
  // data files and images. `returnNullForUnknown` so we can fall through to
  // the media-type heuristics for extensionless uploads.
  const byName = filename ? getFileIconByExtension(filename, true) : null;
  if (byName) {
    return { Icon: byName, label: labelFor(ext, mt) };
  }

  // No recognizable filename — fall back to broad media-type buckets.
  const byMime = mt === 'application/pdf'
    ? getFileIconByExtension('x.pdf', true)
    : mt.includes('spreadsheet') || mt.includes('excel')
      ? getFileIconByExtension('x.xlsx', true)
      : mt.includes('presentation') || mt.includes('powerpoint')
        ? getFileIconByExtension('x.pptx', true)
        : mt.includes('wordprocessing') || mt.includes('msword')
          ? getFileIconByExtension('x.docx', true)
          : mt.startsWith('text/')
            ? getFileIconByExtension('x.txt', true)
            : mt.startsWith('image/')
              ? getFileIconByExtension('x.png', true)
              : null;

  return { Icon: byMime ?? FileText, label: labelFor(ext, mt) };
}

function labelFor(ext: string, mt: string): string {
  if (ext) return ext.toUpperCase();
  if (mt === 'application/pdf') return 'PDF';
  if (mt.includes('spreadsheet') || mt.includes('excel')) return 'Spreadsheet';
  if (mt.includes('presentation') || mt.includes('powerpoint')) return 'Slides';
  if (mt.includes('wordprocessing') || mt.includes('msword')) return 'Doc';
  if (mt.startsWith('text/')) return 'Text';
  if (mt.startsWith('image/')) return 'Image';
  return 'File';
}

/**
 * HTML → clean text extraction for ingestion.
 *
 * Two jobs, both security-relevant:
 *   1. Strip chrome (scripts/styles/nav/header/footer) so we embed *content*,
 *      not boilerplate — better retrieval quality.
 *   2. Remove executable/markup so hidden directives in attributes/CSS/comments
 *      can't be smuggled into the corpus (defence-in-depth paired with the
 *      delimited + spotlighted injection at retrieval time).
 *
 * Dependency-light on purpose: a regex-based cleaner, no JSDOM/cheerio. It is
 * not a full HTML parser — it is a sanitiser that errs toward dropping markup.
 * A host that wants higher-fidelity extraction can pre-clean and pass `text`.
 */

import 'server-only';

/** Tags whose entire contents are noise and must be removed wholesale. */
const STRIP_BLOCKS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'iframe',
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#34': '"',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
      if (code[0] === '#') {
        const num =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : m;
      }
      return NAMED_ENTITIES[code] ?? m;
    });
}

/**
 * Convert an HTML document to readable plain text. Preserves block structure as
 * newlines (so the chunker can split on paragraphs/headings) and collapses
 * runs of whitespace.
 */
export function htmlToCleanText(html: string): string {
  let s = html;

  // Drop comments first (can hide injected instructions).
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Remove noise blocks and their contents.
  for (const tag of STRIP_BLOCKS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    s = s.replace(re, ' ');
    // Self-closing / unclosed variants.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }

  // Turn block-level boundaries into newlines so structure survives as text.
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, '\t');

  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode entities AFTER tag removal so a decoded "<" can't reintroduce markup.
  s = decodeEntities(s);

  // Collapse whitespace: trim each line, drop blank-line runs.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

/** Best-effort `<title>` extraction for a citation label. */
export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return t || undefined;
}

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

/**
 * Convert an HTML document to *markdown-ish* text for the heading-aware chunker.
 *
 * Same security posture as `htmlToCleanText` — this is a sanitiser, not a
 * fidelity-first parser: drop comments first, strip chrome/executable blocks
 * (`STRIP_BLOCKS`) wholesale, and decode entities ONLY after tag removal so a
 * decoded `<` can never reintroduce live markup. Regex-based, ZERO new deps.
 *
 * Where `htmlToCleanText` flattens everything to prose, this one PRESERVES the
 * structure the chunker keys on:
 *   • `<h1>`..`<h6>` → `#`..`######` heading lines (so `chunkMarkdown` can build
 *     the section tree + anchors),
 *   • `<pre>` / `<pre><code class="language-x">` → fenced ``` blocks carrying the
 *     language when it's detectable from the class (so a code sample stays one
 *     atomic, un-torn unit),
 *   • `<li>` → `- ` items, `<br>`/block ends → newlines, `<td>`/`<th>` → tabs.
 *
 * Fenced-code bodies are emitted VERBATIM (entities decoded, tags NOT stripped
 * inside them) — that is safe precisely because fenced content is inert literal
 * text to every downstream consumer (chunker, embedder, renderer), never markup.
 * If a code body itself contains a ``` run we widen the fence (```` …) so the
 * body can't accidentally close the block early.
 */
export function htmlToMarkdown(html: string): string {
  let s = html;

  // Drop comments first (can hide injected instructions).
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Remove noise blocks and their contents (same list + posture as the plain
  // extractor). Runs BEFORE we lift <pre> blocks, so a <script> nested in
  // content is gone before any code extraction can preserve it.
  for (const tag of STRIP_BLOCKS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    s = s.replace(re, ' ');
    // Self-closing / unclosed variants.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }

  // Lift <pre> blocks out into fenced markdown FIRST, before generic tag
  // stripping would destroy their internal newlines. Each fence body is decoded
  // and re-emitted verbatim, then parked behind an opaque `FENCEn` placeholder
  // so the later whitespace/tag passes can't touch its interior; we restore the
  // blocks at the very end.
  const fences: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (whole: string, inner: string) => {
    // Language hint from a `language-x` / `lang-x` class on the <pre> or an
    // inner <code>. Falls back to no language.
    const lang = detectCodeLang(whole);
    // Inside <pre>, an inner <code> is just a wrapper — drop its tags but keep
    // text. Strip any other stray tags, then decode entities. Order matters:
    // decode AFTER tag removal (same rule as everywhere else).
    let body = inner
      .replace(/<\/?code\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    body = decodeEntities(body);
    // Normalise line endings; strip leading/trailing blank lines that markup
    // indentation commonly introduces, but keep interior blank lines.
    body = body.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
    // Pick a fence long enough that the body can't close it early.
    const run = longestBacktickRun(body);
    const fence = run >= 3 ? '`'.repeat(run + 1) : '```';
    fences.push(`${fence}${lang}\n${body}\n${fence}`);
    return `\nFENCE${fences.length - 1}\n`;
  });

  // Headings → `#` lines. Capture level + inner text; strip inner tags/decode.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) return '\n';
    return `\n${'#'.repeat(Number(level))} ${text}\n`;
  });

  // List items → "- " lines (before generic block handling so the marker lands).
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return text ? `\n- ${text}\n` : '\n';
  });

  // Turn block-level boundaries into newlines so structure survives as text.
  s = s.replace(/<\/(p|div|section|article|tr|blockquote|ul|ol)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, '\t');

  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode entities AFTER tag removal so a decoded "<" can't reintroduce markup.
  // (Fenced bodies are already decoded + parked behind placeholders, untouched.)
  s = decodeEntities(s);

  // Collapse whitespace per line, drop blank-line runs. Fence placeholders are
  // plain `FENCEn` word tokens alone on their line, so this trim leaves them
  // intact — their real (whitespace-significant) bodies are parked in `fences`.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore the fenced code blocks.
  s = s.replace(/FENCE(\d+)/g, (_m, i: string) => fences[Number(i)] ?? '');

  return s.trim();
}

/** Longest run of consecutive backticks in `s` (0 if none). Sizes safe fences. */
function longestBacktickRun(s: string): number {
  let max = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) max = Math.max(max, m[0].length);
  return max;
}

/**
 * Best-effort code language from a `<pre …>` blob: the first `language-x` /
 * `lang-x` class token on the <pre> or its inner <code>. Returns '' when
 * undetectable (a bare fence is still valid markdown).
 */
function detectCodeLang(preHtml: string): string {
  const m = /\b(?:language|lang)-([a-z0-9#+.-]+)/i.exec(preHtml);
  return m ? m[1].toLowerCase() : '';
}

/** Best-effort `<title>` extraction for a citation label. */
export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return t || undefined;
}

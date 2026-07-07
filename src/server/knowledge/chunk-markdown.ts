/**
 * Heading-aware markdown chunking.
 *
 * `chunkText` (see ./chunk.ts) is section-blind: it splits on blank lines, so a
 * chunk carries no notion of which heading it lived under, and a multi-line
 * fenced code block gets torn across chunk boundaries — the embedder then sees
 * half a snippet and retrieval quality craters. For a docs corpus that is the
 * whole ballgame, so this chunker keeps structure:
 *
 *   • Build a section tree from `#`..`######` headings and maintain the
 *     breadcrumb (`headingPath`, e.g. `Guide › Persistence › Sliding window`).
 *   • Give every heading a GitHub-style anchor slug (with per-document dedupe),
 *     so a chunk can deep-link to the exact section it came from.
 *   • Pack blocks greedily WITHIN a section up to the token budget; a code fence
 *     is ATOMIC — never split mid-fence (see the cap logic for the pathological
 *     giant-fence case).
 *   • Prepend the breadcrumb to each chunk's text: it is real retrieval signal
 *     (the section title words) and it is what the citation UI reads back.
 *   • Overlap is carried word-aligned WITHIN a section only — never across a
 *     heading boundary (that would blur two sections) and never a partial fence.
 *
 * ≈4-chars/token budgeting, same heuristic as `chunkText` (imported, single
 * source of truth). Non-docs content — no headings AND no code fences — falls
 * straight back to `chunkText`, so plain prose is byte-for-byte unchanged.
 *
 * Cross-repo: the emitted `{ anchor, headingPath }` is the metadata contract the
 * chat-api ingestion worker mirrors so hosted deep-link citations line up. See
 * DOCS_CONTRACT §2/§3.
 */

import 'server-only';
import { chunkText, CHARS_PER_TOKEN, tokensToChars, type ChunkOptions } from './chunk';

/** A chunk with its section provenance for deep-link citations. */
export interface MarkdownChunk {
  /** Breadcrumb line + blank line + content (breadcrumb omitted when empty). */
  text: string;
  /** Anchor slug of the nearest enclosing heading (URL-fragment-ready). */
  anchor?: string;
  /** Heading breadcrumb (h1..hN chain) enclosing this chunk. */
  headingPath?: string[];
}

/** A fenced code block is atomic; other blocks pack/split freely. */
type Block =
  | { kind: 'heading'; level: number; text: string; anchor: string; headingPath: string[] }
  | { kind: 'fence'; text: string; anchor?: string; headingPath: string[] }
  | { kind: 'prose'; text: string; anchor?: string; headingPath: string[] };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
/** A fence opener: ``` or ~~~ (3+), optional info string. Captures the marker. */
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * GitHub-flavoured heading slug: lowercase; drop everything that is not a
 * letter, number, space or hyphen; spaces → hyphens. Duplicate slugs within one
 * document get `-1`, `-2`, … suffixes (mutates `seen`). Matches the anchors a
 * docs site actually renders, so `url#slug` resolves.
 */
export function slugify(text: string, seen?: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    // Keep unicode letters/numbers, ASCII space and hyphen; drop the rest.
    .replace(/[^\p{L}\p{N} \-]/gu, '')
    .replace(/\s+/g, '-');
  if (!seen) return base;
  const prior = seen.get(base);
  if (prior === undefined) {
    seen.set(base, 0);
    return base;
  }
  const next = prior + 1;
  seen.set(base, next);
  return `${base}-${next}`;
}

/**
 * Parse markdown into a flat block list, threading the heading stack so every
 * block knows its enclosing `headingPath` + nearest `anchor`. Fenced code blocks
 * are captured whole (opening marker line through the matching closing marker,
 * or EOF for an unterminated fence) and never inspected for headings.
 */
function parseBlocks(text: string): { blocks: Block[]; headingCount: number; fenceCount: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  // Heading stack: entries are { level, text, anchor }.
  const stack: Array<{ level: number; text: string; anchor: string }> = [];
  const seenSlugs = new Map<string, number>();
  let headingCount = 0;
  let fenceCount = 0;

  const pathNow = (): string[] => stack.map((h) => h.text);
  const anchorNow = (): string | undefined => (stack.length ? stack[stack.length - 1].anchor : undefined);

  let i = 0;
  let proseBuf: string[] = [];

  const flushProse = () => {
    const joined = proseBuf.join('\n').trim();
    if (joined) blocks.push({ kind: 'prose', text: joined, anchor: anchorNow(), headingPath: pathNow() });
    proseBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: consume verbatim to the closing marker of the SAME
    // char + length (GFM rule), or to EOF if never closed.
    const fenceOpen = FENCE_RE.exec(line);
    if (fenceOpen) {
      flushProse();
      const marker = fenceOpen[2][0]; // '`' or '~'
      const openLen = fenceOpen[2].length;
      const body: string[] = [line];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const close = FENCE_RE.exec(l);
        body.push(l);
        i++;
        if (close && close[2][0] === marker && close[2].length >= openLen && close[3].trim() === '') break;
      }
      fenceCount++;
      blocks.push({ kind: 'fence', text: body.join('\n'), anchor: anchorNow(), headingPath: pathNow() });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushProse();
      const level = heading[1].length;
      const htext = heading[2].trim();
      // Pop siblings/deeper headings so the stack holds only ancestors.
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const anchor = slugify(htext, seenSlugs);
      stack.push({ level, text: htext, anchor });
      headingCount++;
      blocks.push({ kind: 'heading', level, text: htext, anchor, headingPath: pathNow() });
      i++;
      continue;
    }

    proseBuf.push(line);
    i++;
  }
  flushProse();

  return { blocks, headingCount, fenceCount };
}

/** Word-aligned tail of `text` ≈`overlapChars` long (mirrors chunk.ts). */
function tailOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return '';
  if (text.length <= overlapChars) return text;
  const slice = text.slice(text.length - overlapChars);
  const space = slice.indexOf(' ');
  return space > 0 ? slice.slice(space + 1) : slice;
}

/** True if a piece of text contains a fence opener (⇒ don't reuse as overlap). */
function hasFence(text: string): boolean {
  return text.split('\n').some((l) => FENCE_RE.test(l));
}

/**
 * Hard-cap a single oversized unit (almost always a giant code fence) at
 * `hardCap` chars, appending a truncation marker so the embedder limit is
 * respected and the reader knows content was clipped. For a fence we keep the
 * closing marker line so the block stays syntactically closed.
 */
function capOversized(text: string, hardCap: number, isFence: boolean): string {
  if (text.length <= hardCap) return text;
  const marker = '… (truncated)';
  if (isFence) {
    const lines = text.split('\n');
    const closer = lines[lines.length - 1];
    const closerIsFence = FENCE_RE.test(closer);
    const budget = Math.max(1, hardCap - marker.length - (closerIsFence ? closer.length + 2 : 1));
    const head = text.slice(0, budget).replace(/\n+$/, '');
    return closerIsFence ? `${head}\n${marker}\n${closer}` : `${head}\n${marker}`;
  }
  return `${text.slice(0, Math.max(1, hardCap - marker.length - 1)).replace(/\s+\S*$/, '')} ${marker}`;
}

/**
 * Chunk markdown into ≈`chunkSize`-token pieces that respect section structure
 * and never split a code fence. Returns ordered chunks with section metadata.
 *
 * Non-docs input (no headings AND no fences) delegates to `chunkText`, so plain
 * prose keeps the exact behavior/output it has today.
 */
export function chunkMarkdown(text: string, opts: ChunkOptions = {}): MarkdownChunk[] {
  const clean = text.trim();
  if (!clean) return [];

  const chunkSize = opts.chunkSize ?? 512;
  const overlap = Math.min(opts.overlap ?? 64, Math.floor(chunkSize / 2));
  const maxChars = tokensToChars(chunkSize);
  const overlapChars = tokensToChars(overlap);
  // Protect the embedder's hard input ceiling from a pathological single fence.
  const hardCap = maxChars * 4;

  const { blocks, headingCount, fenceCount } = parseBlocks(clean);

  // Fallback: nothing structural to key on → identical behavior to the plain
  // chunker. Wrap its strings as anchor-less chunks.
  if (headingCount === 0 && fenceCount === 0) {
    return chunkText(clean, opts).map((t) => ({ text: t }));
  }

  const out: MarkdownChunk[] = [];

  // A "section" is a run of blocks under a heading until the next heading of
  // same-or-higher level. We pack within a section; overlap never crosses one.
  // Emitted chunks inherit the section's anchor + headingPath.
  let secAnchor: string | undefined;
  let secPath: string[] = [];
  let buf = '';
  let carry = ''; // overlap tail from the previous chunk IN THIS SECTION

  const push = (body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const breadcrumb = secPath.length ? `${secPath.join(' › ')}\n\n` : '';
    out.push({
      text: `${breadcrumb}${trimmed}`,
      anchor: secAnchor,
      headingPath: secPath.length ? secPath : undefined,
    });
  };

  /** Flush the current buffer as a chunk and seed `carry` from its tail. */
  const flush = () => {
    if (!buf.trim()) return;
    push(buf);
    // Word-aligned overlap tail — but never carry a (partial) fence forward.
    carry = hasFence(buf) ? '' : tailOverlap(buf, overlapChars);
    buf = '';
  };

  /** Start a fresh section: flush the old one, reset overlap + section meta. */
  const startSection = (anchor: string | undefined, path: string[]) => {
    flush();
    carry = '';
    secAnchor = anchor;
    secPath = path;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      // The heading line itself begins a new section; its breadcrumb (which
      // already ends with this heading's own text) becomes the section path.
      // The text lives in the breadcrumb, so we don't also inline it into body.
      startSection(block.anchor, block.headingPath);
      continue;
    }

    if (block.kind === 'fence') {
      // Atomic. If the running buffer + fence would overflow, flush first so the
      // fence starts a clean chunk; if the fence alone still overflows, it
      // becomes its own (capped) oversized chunk.
      const capped = capOversized(block.text, hardCap, true);
      // Overlap is prose context — never prepend a carry tail to a fence.
      const candidate = buf ? `${buf}\n\n${capped}` : capped;
      if (candidate.length > maxChars && buf) {
        // Buffer + fence overflow: flush the buffer, start the fence clean.
        flush();
        carry = '';
        buf = capped;
      } else {
        buf = candidate;
        carry = '';
      }
      // A fence that alone meets/exceeds budget is its own chunk — emit now so
      // it is never packed with following prose (and never split).
      if (buf.length >= maxChars) flush();
      continue;
    }

    // Prose / list-run. Split into paragraph units and pack greedily; hard-split
    // any single unit that alone exceeds the budget (sentence→word, via chunkText
    // on that unit — reuse, don't reinvent).
    const units = block.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const unitRaw of units) {
      const pieces = unitRaw.length > maxChars ? chunkText(unitRaw, { chunkSize, overlap: 0 }) : [unitRaw];
      for (const unit of pieces) {
        const seed = buf ? buf : carry;
        const candidate = seed ? `${seed}\n\n${unit}` : unit;
        if (candidate.length > maxChars && seed) {
          flush();
          // Seed next chunk with the overlap tail (same-section), then the unit.
          const c = carry;
          carry = '';
          buf = c ? `${c}\n\n${unit}` : unit;
        } else {
          buf = candidate;
          carry = '';
        }
      }
    }
  }
  flush();

  return out;
}

/** Re-export so callers can reason about the budget the same way. */
export { CHARS_PER_TOKEN };

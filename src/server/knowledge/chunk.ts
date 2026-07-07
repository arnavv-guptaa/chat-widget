/**
 * Token-aware text chunking with overlap.
 *
 * Embeddings are token-bounded, so we chunk by an *approximate* token count
 * rather than characters. We avoid a tokenizer dependency (tiktoken is heavy and
 * model-specific) and use the well-worn ≈4-chars-per-token heuristic, which is
 * accurate enough to keep chunks safely under model limits. A host that needs
 * exactness can pre-chunk and pass `text` sources.
 *
 * Strategy: prefer structural boundaries (paragraph breaks, then sentence
 * breaks) before a hard cut, so each chunk is a coherent passage that cites
 * well; carry `overlap` tokens of tail context into the next chunk so meaning
 * isn't severed at a boundary.
 */

import 'server-only';

/**
 * The ≈chars-per-token heuristic. Exported so the heading-aware chunker
 * (`chunk-markdown.ts`) budgets against the SAME constant — one source of truth,
 * no drift between the two chunkers.
 */
export const CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
  /** Target chunk size in tokens. Default 512. */
  chunkSize?: number;
  /** Overlap in tokens carried between adjacent chunks. Default 64. */
  overlap?: number;
}

/** Token budget → char budget (floored, min 1). Shared with `chunkMarkdown`. */
export const tokensToChars = (tokens: number) => Math.max(1, Math.floor(tokens * CHARS_PER_TOKEN));

/** Split text into paragraph units (kept small enough to pack greedily). */
function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Hard-split an over-long single paragraph on sentence then word boundaries. */
function splitLong(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const out: string[] = [];
  // Sentence-ish boundaries first.
  const sentences = block.split(/(?<=[.!?])\s+/);
  let buf = '';
  for (const s of sentences) {
    if (s.length > maxChars) {
      // A single mega-sentence: fall back to word chunks.
      if (buf) {
        out.push(buf);
        buf = '';
      }
      const words = s.split(/\s+/);
      let wbuf = '';
      for (const w of words) {
        if ((wbuf + ' ' + w).trim().length > maxChars) {
          if (wbuf) out.push(wbuf);
          wbuf = w;
        } else {
          wbuf = (wbuf + ' ' + w).trim();
        }
      }
      if (wbuf) out.push(wbuf);
      continue;
    }
    if ((buf + ' ' + s).trim().length > maxChars) {
      if (buf) out.push(buf);
      buf = s;
    } else {
      buf = (buf + ' ' + s).trim();
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Tail of `text` containing approximately `overlapChars` chars, word-aligned. */
function tailOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return text.length <= overlapChars ? text : '';
  const slice = text.slice(text.length - overlapChars);
  const space = slice.indexOf(' ');
  return space > 0 ? slice.slice(space + 1) : slice;
}

/**
 * Chunk `text` into ≈`chunkSize`-token pieces with ≈`overlap`-token overlap.
 * Returns an ordered array; empty input → `[]`.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const clean = text.trim();
  if (!clean) return [];

  const chunkSize = opts.chunkSize ?? 512;
  const overlap = Math.min(opts.overlap ?? 64, Math.floor(chunkSize / 2));
  const maxChars = tokensToChars(chunkSize);
  const overlapChars = tokensToChars(overlap);

  // Expand paragraphs, hard-splitting any that exceed the budget on their own.
  const units = paragraphs(clean).flatMap((p) => splitLong(p, maxChars));
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      // Seed the next chunk with overlap tail for cross-boundary context.
      const carry = tailOverlap(current, overlapChars);
      current = carry ? `${carry}\n\n${unit}` : unit;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

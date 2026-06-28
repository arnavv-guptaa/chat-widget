/**
 * Embedder seam — turns text into vectors for the store/ingestion WITHOUT the
 * caller importing a specific provider, and so the host controls the embedding
 * model + dimension (which MUST match the vector column width).
 *
 * DEFAULT PROVIDER: Google Gemini `gemini-embedding-2` (the latest multimodal
 * embedding model), called over plain REST (`embedContent`) so the package
 * stays dependency-light — no new runtime dep is required for the default path.
 * `gemini-embedding-001` is kept as a fallback constant for hosts that prefer
 * the text-only generation.
 *
 * The store only ever sees an `Embedder` (it never learns the provider), so a
 * BYO consumer can still swap in any provider:
 *   • `createGeminiEmbedder()`             — the default (Gemini REST).
 *   • `createEmbedder(model, dims)`        — wrap ANY AI SDK `EmbeddingModel`
 *                                            (e.g. `google.textEmbedding(...)`,
 *                                            `openai.embedding(...)`).
 *
 * gemini-embedding-2 specifics handled here (per the Gemini embeddings docs):
 *   • `embedContent` takes ONE `content` and returns ONE aggregated embedding —
 *     passing multiple inputs yields a single blended vector. So we embed PER
 *     ITEM (one request per chunk) to get one vector per chunk, with small
 *     bounded concurrency + retry on 429.
 *   • Task type is expressed as a TEXT PREFIX (the `taskType` field is not used
 *     by v2): queries → `task: search result | query: {q}` (RETRIEVAL_QUERY),
 *     documents → `title: {title} | text: {chunk}` (RETRIEVAL_DOCUMENT).
 *   • `output_dimensionality` (in the request `config`) truncates the native
 *     3072-dim vector; we request 1536 and L2-normalize so the
 *     knowledge-drizzle `vector(1536)` column + cosine HNSW index are unchanged.
 *   • The fallback `gemini-embedding-001` uses the classic `taskType` field +
 *     `outputDimensionality`; both response shapes are parsed defensively.
 */

import 'server-only';
import { embedMany, type EmbeddingModel } from 'ai';
import type { Embedder } from './types';

/**
 * Default model + dimension per the build contract. The DEFAULT embedder is now
 * Google Gemini `gemini-embedding-2` at 1536 dims (L2-normalized) — chosen so
 * the existing `vector(1536)` column and cosine index keep working unchanged.
 */
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
/** Text-only fallback model (classic `taskType`-field API). */
export const FALLBACK_EMBEDDING_MODEL = 'gemini-embedding-001';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/** Gemini REST base for the v1beta generative-language endpoint. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Retrieval task types (asymmetric format) we thread through the seam. */
export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Tunables for the default Gemini REST embedder. */
export interface GeminiEmbedderOptions {
  /** Model id. Default `gemini-embedding-2`; fallback `gemini-embedding-001`. */
  model?: string;
  /** Output dimension. MUST equal the vector column width (default 1536). */
  dimensions?: number;
  /**
   * API key. Defaults to `GEMINI_API_KEY`, then `GOOGLE_GENERATIVE_AI_API_KEY`.
   * Resolved lazily (at first embed) so importing the module never throws.
   */
  apiKey?: string;
  /** Override the REST base (testing / proxies). */
  baseUrl?: string;
  /** Max in-flight per-item requests. Default 8. */
  concurrency?: number;
  /** Max retries on 429 / 5xx (exponential backoff). Default 4. */
  maxRetries?: number;
}

/** Is this a gemini-embedding-2-family model (text-prefix task handling)? */
function isV2Model(model: string): boolean {
  return /^(models\/)?gemini-embedding-2/.test(model);
}

/** Strip an optional `models/` prefix so we can build the URL consistently. */
function bareModel(model: string): string {
  return model.replace(/^models\//, '');
}

/**
 * Format a single input for gemini-embedding-2 using the documented task
 * prefixes (asymmetric retrieval). Documents get the `title: … | text: …`
 * structure; queries get `task: search result | query: …`.
 */
function applyV2TaskPrefix(text: string, task: EmbeddingTaskType): string {
  return task === 'RETRIEVAL_QUERY'
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}

/** L2-normalize a vector in place-safe fashion (cosine == dot once normalized). */
function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!norm || !Number.isFinite(norm)) return vec;
  return vec.map((v) => v / norm);
}

/** Pull the float array out of either response shape (v2 `embeddings[]` or 001 `embedding`). */
function extractValues(json: unknown): number[] {
  const obj = json as {
    embedding?: { values?: number[] };
    embeddings?: Array<{ values?: number[] }>;
  };
  // gemini-embedding-2 → { embeddings: [{ values: [...] }] } (one item per request)
  const fromArray = obj.embeddings?.[0]?.values;
  if (Array.isArray(fromArray)) return fromArray;
  // gemini-embedding-001 → { embedding: { values: [...] } }
  const fromSingle = obj.embedding?.values;
  if (Array.isArray(fromSingle)) return fromSingle;
  throw new Error('[chat-widget] Gemini embed response had no embedding values');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Create the DEFAULT embedder: Google Gemini via REST. Returns one
 * `dimensions`-length, L2-normalized vector per input string.
 *
 * Implements `embed` (RETRIEVAL_DOCUMENT, for ingestion) and the optional
 * `embedQuery` (RETRIEVAL_QUERY, for the query path); the knowledge store uses
 * `embedQuery` when present and falls back to `embed` otherwise, so BYO
 * embedders that only implement `embed` keep working.
 */
export function createGeminiEmbedder(opts: GeminiEmbedderOptions = {}): Embedder {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = opts.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const baseUrl = opts.baseUrl ?? GEMINI_API_BASE;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const maxRetries = Math.max(0, opts.maxRetries ?? 4);
  const v2 = isV2Model(model);
  const endpoint = `${baseUrl}/models/${bareModel(model)}:embedContent`;

  function resolveKey(): string {
    const key =
      opts.apiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) {
      throw new Error(
        '[chat-widget] No Gemini API key. Set GEMINI_API_KEY (or ' +
          'GOOGLE_GENERATIVE_AI_API_KEY), or pass a custom embedder.',
      );
    }
    return key;
  }

  /** Embed ONE input string with the right task framing; one request = one vector. */
  async function embedOne(text: string, task: EmbeddingTaskType, apiKey: string): Promise<number[]> {
    // Build the request body per model family.
    const content = {
      parts: [{ text: v2 ? applyV2TaskPrefix(text, task) : text }],
    };
    const body: Record<string, unknown> = v2
      ? {
          model: `models/${bareModel(model)}`,
          content,
          // v2 takes output_dimensionality under `config`; no taskType field.
          config: { output_dimensionality: dimensions },
        }
      : {
          model: `models/${bareModel(model)}`,
          content,
          // 001 takes the classic taskType + outputDimensionality fields.
          taskType: task,
          outputDimensionality: dimensions,
        };

    let attempt = 0;
    // Retry on 429 (rate limit) and 5xx (transient) with exponential backoff.
    for (;;) {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await sleep(2 ** attempt * 250);
        attempt++;
        continue;
      }

      if (res.ok) {
        const json = await res.json();
        let values = extractValues(json);
        // Defensive: honor output_dimensionality even if the API returns native dims.
        if (values.length > dimensions) values = values.slice(0, dimensions);
        return l2normalize(values);
      }

      const retriable = res.status === 429 || res.status >= 500;
      if (!retriable || attempt >= maxRetries) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `[chat-widget] Gemini embed failed (${res.status} ${res.statusText}) ${detail}`.trim(),
        );
      }
      // Respect Retry-After when present, else exponential backoff.
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await sleep(waitMs);
      attempt++;
    }
  }

  /** Embed a batch PER ITEM with bounded concurrency, preserving input order. */
  async function embedBatch(texts: string[], task: EmbeddingTaskType): Promise<number[][]> {
    if (texts.length === 0) return [];
    const apiKey = resolveKey();
    const out = new Array<number[]>(texts.length);
    let cursor = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = cursor++;
        if (i >= texts.length) return;
        out[i] = await embedOne(texts[i], task, apiKey);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => worker());
    await Promise.all(workers);
    return out;
  }

  return {
    dimensions,
    // Ingestion path → documents.
    embed(texts: string[]): Promise<number[][]> {
      return embedBatch(texts, 'RETRIEVAL_DOCUMENT');
    },
    // Query path → queries (store prefers this when present).
    embedQuery(texts: string[]): Promise<number[][]> {
      return embedBatch(texts, 'RETRIEVAL_QUERY');
    },
  };
}

/**
 * The package default embedder. Equivalent to `createGeminiEmbedder()` with the
 * default `gemini-embedding-2` model at 1536 dims. Use this on the default path:
 *
 *   import { getDefaultEmbedder } from '@mordn/chat-widget/server/knowledge';
 *   const embedder = getDefaultEmbedder();           // needs GEMINI_API_KEY
 *   createKnowledgeDrizzleRetriever({ embedder });
 */
export function getDefaultEmbedder(opts: GeminiEmbedderOptions = {}): Embedder {
  return createGeminiEmbedder(opts);
}

/**
 * Wrap any AI SDK embedding model into the `Embedder` seam (BYO / advanced).
 *
 * Use this to plug a provider the AI SDK supports — e.g.
 * `createEmbedder(google.textEmbedding('gemini-embedding-001'))` (add
 * `@ai-sdk/google`) — when you'd rather route through the AI SDK than the
 * default REST embedder.
 *
 * @param model       An AI SDK `EmbeddingModel<string>`.
 * @param dimensions  The model's output dimension. MUST equal the vector column
 *                    width of the store (default 1536). A mismatch silently
 *                    returns garbage, so the store asserts it at construction.
 */
export function createEmbedder(
  model: EmbeddingModel<string>,
  dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS,
): Embedder {
  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      // embedMany batches + parallelises provider calls and preserves order.
      const { embeddings } = await embedMany({ model, values: texts });
      return embeddings;
    },
  };
}

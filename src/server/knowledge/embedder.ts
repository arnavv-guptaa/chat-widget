/**
 * Embedder seam — wraps the AI SDK's embedding models so the store/ingestion
 * can embed text without importing a specific provider, and so the host
 * controls the embedding model + dimension (which MUST match the vector column
 * width).
 *
 * `ai` is an external peer dep so `embed`/`embedMany` resolve to the host's
 * installed AI SDK (v5/v6). The store only ever sees an `Embedder`, never a raw
 * provider key — keys live in the AI SDK provider the host configures.
 */

import 'server-only';
import { embedMany, type EmbeddingModel } from 'ai';
import type { Embedder } from './types';

/** Default model + dimension per the build contract. */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Wrap any AI SDK embedding model into the `Embedder` seam.
 *
 * @param model       An AI SDK `EmbeddingModel<string>` (e.g.
 *                    `openai.embedding('text-embedding-3-small')`).
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

/**
 * Knowledge (RAG) public surface — interfaces + light, dependency-free helpers.
 *
 * Imported via `@mordn/chat-widget/server/knowledge`. This entry pulls NO heavy
 * deps (no `postgres`/`drizzle-orm`): just the contracts, the embedder seam, the
 * ingestion pipeline, and the retrieval glue. The Postgres+pgvector default
 * store lives behind `@mordn/chat-widget/server/knowledge/drizzle`; the hosted
 * HTTP client behind `@mordn/chat-widget/server/knowledge/hosted`.
 *
 *   import { createEmbedder } from '@mordn/chat-widget/server/knowledge';
 *   import { ingest } from '@mordn/chat-widget/server/knowledge';
 */
import 'server-only';

// Contracts
export type {
  Namespace,
  ChunkMetadata,
  RetrievedChunk,
  QueryOptions,
  KnowledgeDoc,
  SourceInfo,
  UpsertResult,
  Retriever,
  KnowledgeStore,
  RetrieverFactory,
  KnowledgeStoreFactory,
  Embedder,
  IngestSource,
  IngestProgress,
  IngestOptions,
  IngestReport,
} from './types';
export { NamespaceAccessError } from './types';

// Embedder seam. Default is Google Gemini `gemini-embedding-2` (REST, 1536-dim,
// L2-normalized); `createEmbedder` still wraps any AI SDK model for BYO.
export {
  createEmbedder,
  createGeminiEmbedder,
  getDefaultEmbedder,
  DEFAULT_EMBEDDING_MODEL,
  FALLBACK_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  type GeminiEmbedderOptions,
  type EmbeddingTaskType,
} from './embedder';

// Ingestion pipeline (admin/server only)
export { ingest, type IngestArgs } from './ingest';
export { chunkText, type ChunkOptions } from './chunk';
// Heading-aware markdown chunker + its markdown-preserving HTML extractor.
// Public because BYO ingestion pipelines want the same structure-aware
// chunking + deep-link anchors the built-in `ingest` uses.
export { chunkMarkdown, slugify, type MarkdownChunk } from './chunk-markdown';
export { htmlToCleanText, htmlToMarkdown, extractTitle } from './extract';
export { expandSources, loadLeaf, isBlockedIp, isMarkdownContent, type LeafSource, type LoadedContent } from './loaders';

// Retrieval glue (tool factory + inject context + citations)
export {
  createSearchKnowledgeTool,
  renderContext,
  toSourceParts,
  citationUrl,
  DEFAULT_TOP_K,
  type SourceUrlPart,
} from './retrieval';

// RAG eval / regression suite (CI-checkable answer-quality gate — retrieval-level,
// no LLM calls). Runs an eval suite against any `Retriever`; see `eval.ts` for the
// versioned file format and the four checks.
export {
  runEvals,
  type EvalFile,
  type EvalCase,
  type EvalExpect,
  type EvalDefaults,
  type EvalCheckResult,
  type EvalRetrieved,
  type EvalCaseResult,
  type EvalRunResult,
  type RunEvalsArgs,
} from './eval';

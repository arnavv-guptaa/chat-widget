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

// Embedder seam
export {
  createEmbedder,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from './embedder';

// Ingestion pipeline (admin/server only)
export { ingest, type IngestArgs } from './ingest';
export { chunkText, type ChunkOptions } from './chunk';
export { htmlToCleanText, extractTitle } from './extract';
export { expandSources, loadLeaf, isBlockedIp, type LeafSource, type LoadedContent } from './loaders';

// Retrieval glue (tool factory + inject context + citations)
export {
  createSearchKnowledgeTool,
  renderContext,
  toSourceParts,
  citationUrl,
  DEFAULT_TOP_K,
  type SourceUrlPart,
} from './retrieval';

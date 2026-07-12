/**
 * Server-core public surface.
 *
 * The pluggable contracts that define the widget's backend. Both the hosted
 * default and any BYO implementation satisfy these. The request router (added
 * next) depends only on these interfaces, never on a concrete DB/storage.
 *
 * Guarded by `server-only`: importing this into a client bundle is a build
 * error, since these types reference server-side concerns and the
 * implementations hold secrets (DB URLs, service keys).
 */
import 'server-only';

export type {
  StoredAttachment,
  StoredConversation,
  StoredMessage,
  ListMessagesOptions,
  SaveTurnInput,
  UsageRecord,
} from './types';

export type { ChatStore, ChatStoreFactory } from './chat-store';
export { ConversationOwnershipError } from './chat-store';

export type {
  StorageAdapter,
  StorageAdapterFactory,
  UploadInput,
  UploadResult,
} from './storage-adapter';

export { createChatHandler } from './handler';
export {
  createMordnHandler,
  type CreateMordnHandlerOptions,
  type MordnAdvancedOptions,
} from './stores/hosted/mordn-handler';
export { createLlmSummarizer, type LlmSummarizerOptions } from './summarize';
export type {
  AgentConfig,
  AgentRuntimeConfig,
  AgentClientConfig,
  PublishedAgentConfig,
  AgentBootstrap,
  SerializableMemoryConfig,
} from '../config';
export { isAgentBootstrap, isAgentConfig } from '../config';
export type {
  CreateChatHandlerOptions,
  ChatRequestContext,
  HostedAgentConfig,
  FeedbackEvent,
  ServerFollowUpConfig,
  BuiltTools,
  UploadPolicy,
  RetrievalConfig,
  MemoryConfig,
} from './handler-types';

// ── Knowledge (RAG) contracts ───────────────────────────────────────────────
// The interfaces + ingestion vocabulary. Concrete stores live behind
// `/server/knowledge`, `/server/knowledge/drizzle`, `/server/knowledge/hosted`.
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
} from './knowledge/types';
export { NamespaceAccessError } from './knowledge/types';

// ── Memory contracts ─────────────────────────────────────────────────────────
// The interface; concrete adapters live behind `/server/memory`,
// `/server/memory/drizzle`, `/server/memory/mem0`, `/server/memory/hosted`.
export type {
  Memory,
  RetrieveOptions,
  RecordOptions,
  MemoryAdapter,
  MemoryAdapterFactory,
} from './memory/types';

// ── Streaming reliability (#163) ─────────────────────────────────────────────
// Production streaming diagnostics: probe a deployment for anti-buffering /
// proxy issues that silently break SSE token streaming.
export { streamHealthCheck } from './stream-health';
export type { StreamHealthResult, StreamHealthCheckOptions } from './stream-health';

// ── Headroom token compression (#—) ──────────────────────────────────────────
// Opt-in model-message compression to fit more history under the token budget.
export {
  compressModelMessages,
  resolveCompression,
  normalizeCompression,
} from './compression';
export type {
  CompressionConfig,
  CompressionOption,
  CompressionResult,
  CompressionSkipReason,
} from './compression';

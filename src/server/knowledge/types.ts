/**
 * Knowledge / RAG contracts — the read/write surfaces for retrieval-augmented
 * generation, plus the ingestion vocabulary.
 *
 * This is the THIRD pluggable backend family of the widget, beside `ChatStore`
 * (conversations) and `StorageAdapter` (attachments). It owns *developer-curated,
 * shared* knowledge: the docs/pages/files an agent answers FROM. It is NOT
 * `MemoryAdapter` (per-user, generated) and NOT the conversation history.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The security model is in the SHAPE of these interfaces, not in their callers.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The contract is deliberately split by **trust level**:
 *
 *   • `Retriever`      — the READ surface. Safe to construct in the chat
 *                        request path (reachable by end users). It can only
 *                        `query`, and it is hard-bound to a set of namespaces at
 *                        construction. There is NO namespace parameter on
 *                        `query`, so a foreign namespace is unrepresentable —
 *                        the same IDOR defence `ChatStore`'s bound `userId`
 *                        gives. It has no `upsert`/`delete`.
 *
 *   • `KnowledgeStore` — the WRITE surface (a superset of read). Used ONLY by
 *                        the ingestion/admin module. Because `createChatHandler`
 *                        is only ever handed a `RetrieverFactory`, there is no
 *                        code path through which an end user can mutate the KB.
 *
 * A BYO backend implements both against one storage; the package wires the
 * read one into the handler and the write one into `ingest()`.
 *
 * Guarded by `server-only`: these types reference server concerns and the
 * implementations hold secrets (DB URL, embedding-provider keys).
 */

import 'server-only';

/**
 * A namespace is the isolation boundary for retrieval — the RAG analogue of
 * `ChatStore`'s bound `userId`. Everything a Retriever/Store touches is fenced
 * inside one or more namespaces, and the namespace value is ALWAYS derived
 * server-side (from agentId / tenantId / verified userId), never from a request
 * body.
 *
 * Convention (opaque to the store, meaningful to the host):
 *   agent:<agentId>            shared agent KB (everyone chatting this agent sees it)
 *   tenant:<tenantId>          org-wide KB
 *   user:<userId>:<agentId>    private "chat with my PDF" docs for one user+agent
 */
export type Namespace = string;

/** Arbitrary, store-filterable metadata stamped on every chunk. */
export type ChunkMetadata = Record<string, string | number | boolean | null>;

// ── Contract types named per the build contract ──────────────────────────────

/**
 * A retrieved chunk + its similarity score, ready to inject + cite. Shaped to
 * map onto an AI SDK `source-url` part for the existing citations UI.
 */
export interface RetrievedChunk {
  /** Stable chunk id (`<namespace>::<source>::<chunkIndex>` in the default store). */
  id: string;
  /** The chunk's text. */
  text: string;
  /** Similarity in [0,1] (cosine or provider-native, normalised by the store). */
  score: number;
  /** Where it came from — drives the citation link + label. */
  source: { url?: string; title?: string };
  /** Filterable/echo metadata (lang, section, chunkIndex, namespace, …). */
  metadata?: Record<string, unknown>;
}

/** Knobs for a single retrieval call. */
export interface QueryOptions {
  /** Max chunks to return. Default 5; the store clamps to a ceiling (20). */
  topK?: number;
  /** Drop chunks below this similarity. Default 0.2 to cut noise. */
  minScore?: number;
  /**
   * Hybrid weighting: 1 = pure vector, 0 = pure lexical (tsvector). Default 1.
   * Stores that don't support lexical ignore it. Hybrid massively helps exact
   * terms (product names, error codes) that embeddings blur.
   */
  vectorWeight?: number;
  /** Equality filter over chunk metadata (e.g. `{ lang: 'en' }`). */
  filter?: ChunkMetadata;
}

/**
 * A unit of knowledge as the host hands it in for upsert (already chunked +
 * cleaned by the ingestion pipeline; pre-embedding).
 */
export interface KnowledgeDoc {
  /** Optional explicit id; the store derives a stable one if omitted. */
  id?: string;
  /** A single chunk's text. */
  text: string;
  /**
   * Stable logical identity of the source this chunk came from — a URL, a file
   * key, a doc slug. Re-ingesting the same `source` REPLACES its chunks
   * (incremental re-sync), so `source` is the dedupe/delete unit, like a row key.
   */
  source: string;
  /** Human title for citations (falls back to `source`). */
  title?: string;
  /** Filterable metadata (lang, section, chunkIndex, contentHash, …). */
  metadata?: Record<string, unknown>;
}

/** A known source in a namespace (admin listing / re-sync planning). */
export interface SourceInfo {
  /** Stable source row id (`<namespace>::<source>` in the default store). */
  id: string;
  /** The logical source (URL / file key / slug). */
  source: string;
  /** Ingestion status: 'ready' once chunks are live (extensible). */
  status: string;
  /** How many chunks this source currently has. */
  chunkCount: number;
  /** ISO timestamp of the last upsert. */
  updatedAt: string;
}

/** Result of an `upsert` — surfaces the incremental-resync accounting. */
export interface UpsertResult {
  upsertedChunks: number;
  /** Sources skipped because their contentHash was unchanged. */
  skippedSources: number;
  /** Orphaned tail chunks deleted because a source shrank. */
  deletedOrphans: number;
}

// ── READ surface — safe in the chat request path ─────────────────────────────

/**
 * The read surface. Construct via a `RetrieverFactory` bound to server-resolved
 * namespaces; `query` is hard-fenced to those namespaces. No namespace
 * parameter ⇒ cross-tenant reads are unrepresentable.
 */
export interface Retriever {
  /**
   * Semantic (+ optionally lexical) search. The store embeds the query string
   * via its configured embedder. MUST restrict results to the namespaces this
   * instance was constructed for — there is no parameter through which a foreign
   * namespace can enter.
   */
  query(input: string, opts?: QueryOptions): Promise<RetrievedChunk[]>;
}

// ── WRITE surface — ingestion / admin ONLY ───────────────────────────────────

/**
 * The full read+write store. Intended for the admin/ingestion module only; it
 * is NOT passed to `createChatHandler`. Keeping the write factory out of the
 * handler's option bag is a structural guarantee that the chat path can't write.
 */
export interface KnowledgeStore extends Retriever {
  /**
   * Insert-or-replace chunks.
   *  - Idempotent on (namespace, source, chunkIndex).
   *  - If every doc for a `source` carries a contentHash already present for
   *    that source, the store no-ops that source (incremental resync).
   *  - Replacing a source with FEWER chunks deletes the orphaned tail
   *    (chunkIndex >= newCount) so shrinking a doc doesn't leave stale chunks.
   * Embeds internally (delegates to the configured embedder).
   */
  upsert(docs: KnowledgeDoc[]): Promise<UpsertResult>;

  /** Delete chunks by source(s) or explicit ids. Idempotent. */
  delete(by: { source?: string; ids?: string[] }): Promise<void>;

  /** List sources in this store's namespace (admin dashboard, resync diffing). */
  listSources(): Promise<SourceInfo[]>;

  /** Wipe the entire namespace (e.g. user deletes their private KB / GDPR). */
  purge(): Promise<void>;
}

/**
 * Constructs a `Retriever` bound to an EXPLICIT, server-resolved set of
 * namespaces. Called from the handler AFTER auth, with namespaces computed from
 * the verified ctx (agentId/tenantId/userId) — NEVER from the request body.
 */
export type RetrieverFactory = (namespaces: Namespace[]) => Retriever;

/**
 * Constructs the full read+write store, bound to ONE namespace (the write/
 * delete/list/purge surface operates within it). Intended for the
 * admin/ingestion module only; it is never passed to `createChatHandler`.
 */
export type KnowledgeStoreFactory = (namespace: Namespace) => KnowledgeStore;

/**
 * The embedding seam, so the store stays model-agnostic. The default
 * implementation is Google Gemini (`gemini-embedding-2`, 1536-dim, L2-normalized)
 * over REST; BYO consumers can wrap any AI SDK model via `createEmbedder`. The
 * host controls the model + dimension, which must match the vector column width.
 */
export interface Embedder {
  /** MUST equal the vector column width (e.g. 1536). */
  readonly dimensions: number;
  /**
   * Embed a batch of DOCUMENT chunks (order-preserving). The hot path for
   * ingestion — providers that support retrieval task types should frame these
   * as `RETRIEVAL_DOCUMENT`.
   */
  embed(texts: string[]): Promise<number[][]>;
  /**
   * OPTIONAL query-side embedding (order-preserving). Lets task-type-aware
   * providers frame inputs as `RETRIEVAL_QUERY` for asymmetric retrieval. The
   * store uses this for the query path when present and falls back to `embed`
   * otherwise — so an embedder that only implements `embed` still works.
   */
  embedQuery?(texts: string[]): Promise<number[][]>;
}

/**
 * Thrown by write/list methods when the target namespace is out of scope for
 * the store. Callers map this to HTTP 403 (admin path). Reads never throw — they
 * return `[]` — so existence of another namespace can't be probed.
 */
export class NamespaceAccessError extends Error {
  constructor(public readonly namespace: Namespace) {
    super(`Namespace ${namespace} is out of scope for this store`);
    this.name = 'NamespaceAccessError';
  }
}

// ── Ingestion (admin/server only) ────────────────────────────────────────────

/** A source to ingest. `crawl`/`sitemap`/`url` are SSRF-guarded at load time. */
export type IngestSource =
  | { type: 'url'; url: string; title?: string }
  | { type: 'sitemap'; url: string; limit?: number }
  | { type: 'crawl'; url: string; depth?: number; maxPages?: number; sameOriginOnly?: boolean }
  | { type: 'file'; path?: string; fileKey?: string; filename?: string; mediaType?: string }
  | { type: 'text'; text: string; title?: string };

/** Progress event surfaced by `ingest`'s `onProgress`. */
export interface IngestProgress {
  /** done count of `total` units processed so far. */
  done: number;
  total: number;
  /** Coarse stage label: 'fetch' | 'extract' | 'chunk' | 'embed' | 'upsert' | 'done' | 'error'. */
  stage: string;
  /** The source currently being processed (when applicable). */
  source?: string;
  /** Optional human message (e.g. an error string). */
  message?: string;
}

/** Tunables for `ingest`. */
export interface IngestOptions {
  /** Target chunk size in TOKENS (approx). Default 512. */
  chunkSize?: number;
  /** Overlap in tokens to preserve context across boundaries. Default 64. */
  overlap?: number;
  /** Bounded concurrency for fetch/embed. Default 4. */
  concurrency?: number;
  /**
   * Crawl/SSRF safety rails. Defaults: same-origin only, maxPages 50, depth 2,
   * 10s request timeout. `allowDomains` further restricts host matching.
   */
  crawl?: {
    allowDomains?: string[];
    maxPages?: number;
    maxDepth?: number;
    requestTimeoutMs?: number;
    userAgent?: string;
    sameOriginOnly?: boolean;
  };
  /** Progress callback — drives a dashboard progress bar / SSE. */
  onProgress?: (p: IngestProgress) => void;
}

/** Summary returned by `ingest` (also see per-source errors in the report). */
export interface IngestReport {
  sources: number;
  chunks: number;
  /** Sources skipped because their contentHash was unchanged. */
  skipped: number;
  /** Orphaned tail chunks deleted because a source shrank. */
  deleted: number;
  /** Per-source failures (loader/extract/embed) — ingest never throws on one. */
  errors: { source: string; error: string }[];
  durationMs: number;
}

/**
 * Default KnowledgeStore implementation — Postgres + pgvector via Drizzle.
 *
 * One implementation of the `KnowledgeStore`/`Retriever` interfaces — the
 * interfaces, not this file, are the contract. It reuses the existing
 * `getDrizzleDb` pool (no second connection manager) and ships its own schema +
 * SQL migration (`CREATE EXTENSION vector`, the generated tsvector column, and
 * the HNSW/GIN indexes).
 *
 * Security invariants upheld here (mirroring the chat store):
 *   • A `Retriever`/`KnowledgeStore` is bound to namespace(s) at construction.
 *   • `query` is hard-fenced to those namespaces — there is no namespace
 *     parameter, so a foreign namespace is unrepresentable.
 *   • Writes assert the bound namespace (`NamespaceAccessError` → 403).
 *   • `upsert` is idempotent on (namespace, source, chunkIndex), short-circuits
 *     unchanged sources by contentHash, and deletes the orphaned tail when a
 *     source shrinks.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  NamespaceAccessError,
  type Embedder,
  type KnowledgeDoc,
  type KnowledgeStore,
  type KnowledgeStoreFactory,
  type Namespace,
  type QueryOptions,
  type RetrievedChunk,
  type RetrieverFactory,
  type SourceInfo,
  type UpsertResult,
} from '../../knowledge/types';
import { getDrizzleDb, type DrizzleClientOptions, type DrizzleDb } from '../drizzle/client';
import {
  EMBED_DIM,
  knowledgeChunks,
  knowledgeSources,
  type KnowledgeSourceRow,
} from './schema';

const TOPK_CEILING = 20;
const DEFAULT_TOPK = 5;
const DEFAULT_MIN_SCORE = 0.2;

/** Serialise an embedding to the pgvector literal form for a raw SQL cast. */
function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

class PgVectorKnowledgeStore implements KnowledgeStore {
  constructor(
    public readonly namespaces: ReadonlyArray<Namespace>,
    private readonly db: DrizzleDb,
    private readonly embedder: Embedder,
  ) {
    if (embedder.dimensions !== EMBED_DIM) {
      // Fail loud at construction — a dimension mismatch silently returns
      // garbage results (and breaks inserts).
      throw new Error(
        `[chat-widget] embedder dim ${embedder.dimensions} != column ${EMBED_DIM}. ` +
          'Re-migrate the vector column or pass a matching embedder.',
      );
    }
  }

  /** The single namespace a write-bound store targets (first/only entry). */
  private writeNamespace(): Namespace {
    const ns = this.namespaces[0];
    if (!ns) throw new NamespaceAccessError('<none>');
    return ns;
  }

  async query(input: string, opts: QueryOptions = {}): Promise<RetrievedChunk[]> {
    if (this.namespaces.length === 0) return [];
    const topK = Math.min(Math.max(opts.topK ?? DEFAULT_TOPK, 1), TOPK_CEILING);
    const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
    const w = opts.vectorWeight ?? 1;

    const [embedding] = await this.embedder.embed([input]);
    if (!embedding) return [];
    const vec = sql.raw(`'${vectorLiteral(embedding)}'::vector`);

    // Hard namespace fence — the ONLY namespaces are this.namespaces. A caller
    // cannot widen it; there is no namespace parameter on query().
    const nsList = sql.raw(
      `(${this.namespaces.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})`,
    );

    // Optional metadata equality filter (JSONB containment).
    const metaFilter = opts.filter
      ? sql`AND metadata @> ${JSON.stringify(opts.filter)}::jsonb`
      : sql``;

    // Hybrid score: w * (1 - cosine_distance) + (1-w) * ts_rank.
    // Pure vector when w = 1. The generated `tsv` column powers the lexical leg.
    const rows = await this.db.execute(sql`
      SELECT id, namespace, source, title, chunk_index, content, metadata,
             (${w} * (1 - (embedding <=> ${vec}))
              + ${1 - w} * COALESCE(ts_rank(tsv, plainto_tsquery('english', ${input})), 0)) AS score
      FROM ${knowledgeChunks}
      WHERE namespace IN ${nsList} ${metaFilter}
      ORDER BY score DESC
      LIMIT ${topK}
    `);

    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return (list as Array<Record<string, unknown>>)
      .map((r): RetrievedChunk => {
        const source = String(r.source ?? '');
        const title = (r.title as string) || source;
        const isUrl = /^https?:\/\//.test(source);
        return {
          id: String(r.id ?? ''),
          text: String(r.content ?? ''),
          score: Number(r.score ?? 0),
          source: { url: isUrl ? source : undefined, title },
          metadata: {
            ...((r.metadata as Record<string, unknown>) ?? {}),
            namespace: r.namespace,
            chunkIndex: r.chunk_index,
            sourceRef: source,
          },
        };
      })
      .filter((c) => c.score >= minScore);
  }

  async upsert(docs: KnowledgeDoc[]): Promise<UpsertResult> {
    const namespace = this.writeNamespace();
    if (docs.length === 0) return { upsertedChunks: 0, skippedSources: 0, deletedOrphans: 0 };

    // Group by source; one source = one resync unit. Order within a source is
    // the array order → chunkIndex.
    const bySource = new Map<string, KnowledgeDoc[]>();
    for (const d of docs) {
      const arr = bySource.get(d.source);
      if (arr) arr.push(d);
      else bySource.set(d.source, [d]);
    }

    let upsertedChunks = 0;
    let skippedSources = 0;
    let deletedOrphans = 0;

    for (const [source, chunks] of bySource) {
      const contentHash =
        (chunks[0].metadata?.contentHash as string | undefined) ??
        deriveHash(chunks.map((c) => c.text).join('\n'));

      const existing = await this.db
        .select({ h: knowledgeSources.contentHash })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.namespace, namespace), eq(knowledgeSources.source, source)))
        .limit(1);

      // INCREMENTAL RESYNC short-circuit: unchanged content → skip entirely.
      if (existing[0]?.h === contentHash) {
        skippedSources++;
        continue;
      }

      // Embed all chunks for this source in one batched call.
      const vectors = await this.embedder.embed(chunks.map((c) => c.text));
      const title = chunks[0].title ?? source;
      const values = chunks.map((c, i) => ({
        id: c.id ?? `${namespace}::${source}::${i}`,
        namespace,
        source,
        title: c.title ?? title,
        chunkIndex: i,
        content: c.text,
        embedding: vectors[i],
        contentHash,
        metadata: c.metadata ?? {},
      }));

      await this.db
        .insert(knowledgeChunks)
        .values(values)
        .onConflictDoUpdate({
          target: [knowledgeChunks.namespace, knowledgeChunks.source, knowledgeChunks.chunkIndex],
          set: {
            content: sql`excluded.content`,
            embedding: sql`excluded.embedding`,
            contentHash: sql`excluded.content_hash`,
            title: sql`excluded.title`,
            metadata: sql`excluded.metadata`,
          },
        });
      upsertedChunks += values.length;

      // Delete orphaned tail if the doc shrank (chunkIndex >= newCount).
      const del = await this.db
        .delete(knowledgeChunks)
        .where(
          and(
            eq(knowledgeChunks.namespace, namespace),
            eq(knowledgeChunks.source, source),
            sql`${knowledgeChunks.chunkIndex} >= ${chunks.length}`,
          ),
        )
        .returning({ id: knowledgeChunks.id });
      deletedOrphans += del.length;

      await this.db
        .insert(knowledgeSources)
        .values({
          id: `${namespace}::${source}`,
          namespace,
          source,
          title,
          status: 'ready',
          contentHash,
          chunkCount: chunks.length,
          metadata: (chunks[0].metadata as Record<string, unknown>) ?? {},
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: knowledgeSources.id,
          set: {
            contentHash,
            chunkCount: chunks.length,
            title,
            status: 'ready',
            error: null,
            updatedAt: new Date(),
          },
        });
    }

    return { upsertedChunks, skippedSources, deletedOrphans };
  }

  async delete(by: { source?: string; ids?: string[] }): Promise<void> {
    const namespace = this.writeNamespace();
    if (by.ids && by.ids.length) {
      await this.db
        .delete(knowledgeChunks)
        .where(and(eq(knowledgeChunks.namespace, namespace), inArray(knowledgeChunks.id, by.ids)));
    }
    if (by.source) {
      await this.db
        .delete(knowledgeChunks)
        .where(and(eq(knowledgeChunks.namespace, namespace), eq(knowledgeChunks.source, by.source)));
      await this.db
        .delete(knowledgeSources)
        .where(and(eq(knowledgeSources.namespace, namespace), eq(knowledgeSources.source, by.source)));
    }
  }

  async listSources(): Promise<SourceInfo[]> {
    const namespace = this.writeNamespace();
    const rows = await this.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.namespace, namespace));
    return rows.map((r: KnowledgeSourceRow) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      chunkCount: r.chunkCount,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async purge(): Promise<void> {
    const namespace = this.writeNamespace();
    await this.db.delete(knowledgeChunks).where(eq(knowledgeChunks.namespace, namespace));
    await this.db.delete(knowledgeSources).where(eq(knowledgeSources.namespace, namespace));
  }
}

/** sha256 of text, for the contentHash fallback when ingest didn't supply one. */
function deriveHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface PgVectorKnowledgeOptions extends DrizzleClientOptions {
  /** Embedder whose `dimensions` MUST equal the vector column width (1536). */
  embedder: Embedder;
}

/**
 * Read-only factory for the handler. Pass to
 * `createChatHandler({ retrieval: { store: createKnowledgeDrizzleRetriever({ embedder }) } })`.
 */
export function createKnowledgeDrizzleRetriever(
  opts: PgVectorKnowledgeOptions,
): RetrieverFactory {
  const db = getDrizzleDb(opts);
  return (namespaces) => new PgVectorKnowledgeStore(namespaces, db, opts.embedder);
}

/**
 * Read+write factory for the ingestion/admin module ONLY. Bound to ONE
 * namespace; never passed to `createChatHandler`.
 *
 *   const store = createKnowledgeDrizzleStore({ embedder })(`agent:${agentId}`);
 *   await ingest({ store, namespace: `agent:${agentId}`, sources, embedder });
 */
export function createKnowledgeDrizzleStore(
  opts: PgVectorKnowledgeOptions,
): KnowledgeStoreFactory {
  const db = getDrizzleDb(opts);
  return (namespace) => new PgVectorKnowledgeStore([namespace], db, opts.embedder);
}

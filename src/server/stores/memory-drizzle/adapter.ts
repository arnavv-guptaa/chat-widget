/**
 * Default long-term memory adapter — Postgres via Drizzle.
 *
 * Mirrors `createDrizzleChatStore`: a shared pool, a per-request user-bound
 * instance, security invariants upheld in every method (every query starts
 * scoped to (userId, agentId) — the boundary). Adds zero new runtime deps and
 * degrades gracefully:
 *   • no embedding model → keyword (full-text) retrieval, no embeddings stored;
 *   • no extraction model → heuristic extraction;
 *   • no pgvector → still works (the embedding column stays NULL).
 */

import 'server-only';
import { and, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { embed, generateId, type EmbeddingModel, type LanguageModel } from 'ai';
import { createHash } from 'node:crypto';

import type {
  ListOptions,
  Memory,
  MemoryAdapter,
  MemoryAdapterFactory,
  MemoryScope,
  RecordOptions,
  RetrieveOptions,
} from '../../memory/types';
import {
  heuristicExtract,
  llmExtract,
  redactDelta,
  renderTurn,
  type MemoryDelta,
} from '../../memory/extract';
import { getDrizzleDb, type DrizzleClientOptions, type DrizzleDb } from '../drizzle/client';
import { memories, type MemoryRow } from './schema';

const MAX_RETRIEVE = 8;
const MAX_LIST = 100;
const EXISTING_SLICE = 50;

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
function contentHash(text: string): string {
  return createHash('sha256').update(normalise(text)).digest('hex');
}

function toMemory(row: MemoryRow, score?: number): Memory {
  return {
    id: row.id,
    text: row.text,
    score,
    scope: (row.scope as MemoryScope) ?? 'user',
    createdAt: row.createdAt.toISOString(),
    metadata: {
      kind: row.kind,
      sourceConversationId: row.sourceConversationId ?? undefined,
      orgId: row.orgId ?? undefined,
      ...((row.metadata as Record<string, unknown>) ?? {}),
    },
  };
}

class DrizzleMemoryAdapter implements MemoryAdapter {
  constructor(
    public readonly userId: string,
    private readonly db: DrizzleDb,
    private readonly agentId: string,
    private readonly embeddingModel: EmbeddingModel<string> | null,
    private readonly extractionModel: LanguageModel | null,
    private readonly ttlDays: number | null,
  ) {}

  /** Every query starts scoped to (user, agent) — the isolation boundary. */
  private base() {
    return and(eq(memories.userId, this.userId), eq(memories.agentId, this.agentId));
  }

  /** Exclude expired rows (TTL). */
  private notExpired() {
    return or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date()));
  }

  /**
   * Build the WHERE predicate for a set of tiers (#167). 'user'/'session' are
   * scoped to the bound (user, agent); 'org' is shared by (org_id, agent) and
   * therefore requires a server-verified `orgId`. A requested tier missing its
   * required key (session→conversationId, org→orgId) is dropped — a mis-config
   * never widens access — and if nothing resolves we fall back to the bound
   * user's own 'user' tier.
   */
  private scopeWhere(scopes: MemoryScope[], conversationId?: string, orgId?: string): SQL {
    const agent = this.agentId;
    const want = new Set<MemoryScope>(scopes.length ? scopes : ['user']);
    const clauses: SQL[] = [];
    if (want.has('user')) {
      clauses.push(sql`(user_id = ${this.userId} AND agent_id = ${agent} AND scope = 'user')`);
    }
    if (want.has('session') && conversationId) {
      clauses.push(
        sql`(user_id = ${this.userId} AND agent_id = ${agent} AND scope = 'session' AND source_conversation_id = ${conversationId})`,
      );
    }
    if (want.has('org') && orgId) {
      clauses.push(sql`(org_id = ${orgId} AND agent_id = ${agent} AND scope = 'org')`);
    }
    if (clauses.length === 0) {
      clauses.push(sql`(user_id = ${this.userId} AND agent_id = ${agent} AND scope = 'user')`);
    }
    return sql`(${sql.join(clauses, sql` OR `)})`;
  }

  async retrieve(opts: RetrieveOptions): Promise<Memory[]> {
    const limit = Math.min(Math.max(opts.limit ?? MAX_RETRIEVE, 1), MAX_RETRIEVE);
    // Tiers to search (#167). Default ['user'] preserves Phase-1 behaviour.
    const where = this.scopeWhere(opts.scopes ?? ['user'], opts.conversationId, opts.orgId);
    try {
      // Semantic path when we have both an embedding model and a query.
      if (this.embeddingModel && opts.query) {
        const { embedding } = await embed({ model: this.embeddingModel, value: opts.query });
        const vec = sql.raw(`'[${embedding.join(',')}]'::vector`);
        const rows = await this.db.execute(sql`
          SELECT id, user_id, agent_id, scope, org_id, text, kind, content_hash, source_conversation_id,
                 metadata, expires_at, created_at, updated_at,
                 (1 - (embedding <=> ${vec})) AS score
          FROM ${memories}
          WHERE ${where}
            AND embedding IS NOT NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY score DESC
          LIMIT ${limit}
        `);
        const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
        return (list as Array<Record<string, unknown>>)
          .map((r) => ({ row: rawToRow(r), score: Number(r.score ?? 0) }))
          .filter((r) => r.score >= (opts.minScore ?? 0))
          .map((r) => toMemory(r.row, r.score));
      }

      // Keyword fallback (no embedding model): Postgres FTS, or most-recent.
      if (opts.query) {
        const rows = await this.db.execute(sql`
          SELECT id, user_id, agent_id, scope, org_id, text, kind, content_hash, source_conversation_id,
                 metadata, expires_at, created_at, updated_at,
                 ts_rank(to_tsvector('english', text), plainto_tsquery('english', ${opts.query})) AS score
          FROM ${memories}
          WHERE ${where}
            AND (expires_at IS NULL OR expires_at > now())
            AND to_tsvector('english', text) @@ plainto_tsquery('english', ${opts.query})
          ORDER BY score DESC
          LIMIT ${limit}
        `);
        const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
        const mapped = (list as Array<Record<string, unknown>>).map((r) =>
          toMemory(rawToRow(r), Number(r.score ?? 0)),
        );
        if (mapped.length) return mapped;
        // FTS found nothing → fall through to most-recent so memory still helps.
      }

      const recent = await this.db
        .select()
        .from(memories)
        .where(and(where, this.notExpired()))
        .orderBy(desc(memories.updatedAt))
        .limit(limit);
      return recent.map((r) => toMemory(r));
    } catch {
      // Fail soft — a memory hiccup must never block a reply.
      return [];
    }
  }

  async record(opts: RecordOptions): Promise<void> {
    const turnText = renderTurn(opts.messages);
    if (!turnText.trim()) return;

    // Tier to extract into (#167). Default 'user' preserves Phase-1 behaviour.
    const scope: MemoryScope = opts.scope ?? 'user';
    const orgId = scope === 'org' ? opts.orgId ?? null : null;

    // Pull a small slice of existing SAME-TIER memories so the extractor can
    // dedupe/supersede within the tier (a session note never supersedes a
    // durable user preference, and vice-versa).
    const existing = await this.db
      .select({ id: memories.id, text: memories.text })
      .from(memories)
      .where(and(this.base(), eq(memories.scope, scope)))
      .orderBy(desc(memories.updatedAt))
      .limit(EXISTING_SLICE);

    let delta: MemoryDelta = this.extractionModel
      ? await llmExtract(this.extractionModel, turnText, existing)
      : heuristicExtract(turnText);
    delta = redactDelta(delta);
    if (!delta.upserts.length && !delta.deletes.length) return;

    // Supersede stale facts the extractor flagged.
    for (const id of delta.deletes) await this.forget(id);

    const expiresAt = this.ttlDays ? new Date(Date.now() + this.ttlDays * 864e5) : null;

    // Embed in one batch when possible.
    let vectors: (number[] | null)[] = delta.upserts.map(() => null);
    if (this.embeddingModel && delta.upserts.length) {
      try {
        // embed one-by-one to keep the dep surface minimal; small N (<=20).
        vectors = await Promise.all(
          delta.upserts.map(async (u) => {
            const { embedding } = await embed({ model: this.embeddingModel!, value: u.text });
            return embedding;
          }),
        );
      } catch {
        vectors = delta.upserts.map(() => null);
      }
    }

    for (let i = 0; i < delta.upserts.length; i++) {
      const u = delta.upserts[i];
      await this.db
        .insert(memories)
        .values({
          id: generateId(),
          userId: this.userId,
          agentId: this.agentId,
          scope,
          orgId,
          text: u.text,
          kind: u.kind,
          embedding: vectors[i] ?? null,
          contentHash: contentHash(u.text),
          sourceConversationId: opts.conversationId,
          expiresAt,
          metadata: {},
        })
        .onConflictDoUpdate({
          target: [memories.userId, memories.agentId, memories.scope, memories.contentHash],
          set: { updatedAt: new Date(), sourceConversationId: opts.conversationId },
        });
    }
  }

  async list(opts?: ListOptions): Promise<Memory[]> {
    // Default to the bound user's own 'user' tier (Phase-1 behaviour). Callers
    // pass `scope` to broaden; 'org' additionally needs `orgId`.
    const scopes: MemoryScope[] = opts?.scope
      ? Array.isArray(opts.scope)
        ? opts.scope
        : [opts.scope]
      : ['user'];
    const where = this.scopeWhere(scopes, undefined, opts?.orgId);
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(where, this.notExpired()))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_LIST);
    return rows.map((r) => toMemory(r));
  }

  async forget(id: string): Promise<void> {
    // Scope the delete to the bound user+agent: a foreign id deletes nothing.
    await this.db.delete(memories).where(and(eq(memories.id, id), this.base()));
  }

  async forgetAll(opts?: { scope?: MemoryScope }): Promise<void> {
    // Always scoped to the bound user (base) so a user erasure never bulk-deletes
    // another user's shared 'org' memories. `opts.scope` narrows to one tier.
    const where = opts?.scope ? and(this.base(), eq(memories.scope, opts.scope)) : this.base();
    await this.db.delete(memories).where(where);
  }
}

/** Coerce a raw SQL row (snake_case) into a typed MemoryRow. */
function rawToRow(r: Record<string, unknown>): MemoryRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    agentId: String(r.agent_id),
    scope: String(r.scope ?? 'user'),
    orgId: (r.org_id as string) ?? null,
    text: String(r.text),
    kind: String(r.kind),
    embedding: null,
    contentHash: String(r.content_hash),
    sourceConversationId: (r.source_conversation_id as string) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? null,
    expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

export interface DrizzleMemoryOptions {
  /** Agent namespace; scopes every query by (userId, agentId). Default 'default'. */
  agentId?: string;
  /** Embedding model. Omit → keyword-only mode (no embeddings stored). */
  embeddingModel?: EmbeddingModel<string>;
  /** Extraction model. Omit → heuristic extraction (no extra model call). */
  extractionModel?: LanguageModel;
  /** Retention TTL in days. Omit → keep forever. */
  retentionDays?: number;
  /** Drizzle client options (connection string / pool size). */
  client?: DrizzleClientOptions;
}

/**
 * Create a `MemoryAdapterFactory` backed by the default Drizzle/Postgres memory.
 * Pass to `createChatHandler({ memory: { adapter: createDrizzleMemory({...}) } })`.
 */
export function createDrizzleMemory(opts: DrizzleMemoryOptions = {}): MemoryAdapterFactory {
  const db = getDrizzleDb(opts.client);
  const agentId = opts.agentId ?? 'default';
  return (userId) =>
    new DrizzleMemoryAdapter(
      userId,
      db,
      agentId,
      opts.embeddingModel ?? null,
      opts.extractionModel ?? null,
      opts.retentionDays ?? null,
    );
}

/**
 * mem0 memory adapter — a thin `MemoryAdapter` over the mem0 REST API.
 *
 * mem0 already does per-user memory: extraction + consolidation happen
 * SERVER-SIDE, so `record` just passes the raw turn and mem0 extracts. The
 * mapping is almost 1:1, which validates the contract:
 *
 *   retrieve({query,limit}) → POST /v1/memories/search  (filters: user_id + agent_id)
 *   record({messages})      → POST /v1/memories         (mem0 extracts)
 *   list()                  → GET  /v1/memories         (user_id + agent_id)
 *   forget(id)              → DELETE /v1/memories/:id
 *   forgetAll()             → DELETE /v1/memories        (user_id + agent_id)
 *
 * The bound `userId` becomes mem0's `user_id`; the per-request factory is the
 * IDOR boundary; the agent namespace becomes mem0's `agent_id`. No extraction
 * model of our own — mem0 is the extractor. The API key is server-side only
 * (`server-only`), like the Supabase service-role key.
 *
 * NOTE: mem0's exact field names/paths vary by version; this client targets the
 * v1 REST shape and is intentionally tolerant when parsing responses. Adjust
 * `baseUrl`/paths for self-hosted mem0 (OSS) vs. the managed platform.
 */

import 'server-only';
import type {
  Memory,
  MemoryAdapter,
  MemoryAdapterFactory,
  RecordOptions,
  RetrieveOptions,
} from '../../memory/types';
import { withFetchTimeout, DEFAULT_HTTP_TIMEOUT_MS } from '../../http';

const DEFAULT_BASE_URL = 'https://api.mem0.ai';

function normaliseMem0(raw: Record<string, unknown>): Memory {
  return {
    id: String(raw.id ?? raw.memory_id ?? ''),
    text: String(raw.memory ?? raw.text ?? raw.data ?? ''),
    score: raw.score != null ? Number(raw.score) : undefined,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

class Mem0MemoryAdapter implements MemoryAdapter {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(
    public readonly userId: string,
    private readonly apiKey: string,
    private readonly agentId: string,
    baseUrl: string,
    fetchImpl: typeof fetch,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
    this.doFetch = fetchImpl;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  private filters() {
    return { user_id: this.userId, agent_id: this.agentId };
  }

  async retrieve(opts: RetrieveOptions): Promise<Memory[]> {
    try {
      const res = await this.doFetch(`${this.base}/v1/memories/search/`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ query: opts.query, limit: opts.limit ?? 8, ...this.filters() }),
      });
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as unknown;
      const rows = Array.isArray(data) ? data : ((data as { results?: unknown[] })?.results ?? []);
      return (rows as Record<string, unknown>[])
        .map(normaliseMem0)
        .filter((m) => (opts.minScore != null && m.score != null ? m.score >= opts.minScore : true));
    } catch {
      return [];
    }
  }

  async record(opts: RecordOptions): Promise<void> {
    // mem0 accepts the raw messages and extracts server-side.
    await this.doFetch(`${this.base}/v1/memories/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        messages: opts.messages,
        ...this.filters(),
        metadata: { conversationId: opts.conversationId },
      }),
    }).catch(() => {});
  }

  async list(): Promise<Memory[]> {
    const params = new URLSearchParams({ user_id: this.userId, agent_id: this.agentId });
    const res = await this.doFetch(`${this.base}/v1/memories/?${params}`, { headers: this.headers() });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(data) ? data : ((data as { results?: unknown[] })?.results ?? []);
    return (rows as Record<string, unknown>[]).map(normaliseMem0);
  }

  async forget(id: string): Promise<void> {
    await this.doFetch(`${this.base}/v1/memories/${encodeURIComponent(id)}/`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {});
  }

  async forgetAll(): Promise<void> {
    const params = new URLSearchParams({ user_id: this.userId, agent_id: this.agentId });
    await this.doFetch(`${this.base}/v1/memories/?${params}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {});
  }
}

export interface Mem0Options {
  /** mem0 API key. Required. Server-side only. */
  apiKey: string;
  /** Agent namespace → mem0's `agent_id`. Default 'default'. */
  agentId?: string;
  /** API base URL. Defaults to the managed platform; override for self-host. */
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetch?: typeof fetch;
  /** Per-request timeout (ms) for the mem0 API. Defaults to 30s; `0` disables. */
  timeoutMs?: number;
}

/**
 * Create a `MemoryAdapterFactory` backed by mem0. Because mem0 extracts
 * server-side, drop `extractionModel` — there's nothing to configure locally.
 *
 *   adapter: createMem0Memory({ apiKey: process.env.MEM0_API_KEY, agentId: 'support-bot' })
 */
export function createMem0Memory(options: Mem0Options): MemoryAdapterFactory {
  if (!options.apiKey) throw new Error('[chat-widget] createMem0Memory requires an apiKey');
  const agentId = options.agentId ?? 'default';
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (userId) => new Mem0MemoryAdapter(userId, options.apiKey, agentId, baseUrl, fetchImpl);
}

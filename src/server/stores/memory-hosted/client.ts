/**
 * Hosted memory adapter — a thin HTTP client over @mordn/chat-api's
 * `/v1/memory/*` endpoints. Same `MemoryAdapter` interface as the Drizzle/mem0
 * adapters, so switching is a one-line change:
 *
 *   memory: { adapter: createHostedMemory({ apiKey: process.env.MORDN_CHAT_KEY, agentId }) }
 *
 * Identity: the `apiKey` authenticates the TENANT; the per-request `userId` the
 * handler binds is sent as `X-Chat-User` (the end user, from the consumer's
 * verified session — same trust model as getUserId). The hosted service enforces
 * tenant + agent + user scoping; this client only carries identity.
 *
 * Endpoints (per the build contract):
 *   retrieve → POST   /v1/memory/query   { agentId, query, limit }
 *   record   → POST   /v1/memory/record  { agentId, conversationId, messages }
 *   list     → GET    /v1/memory?agentId=
 *   forget   → DELETE /v1/memory/:id
 *   forgetAll→ DELETE /v1/memory?agentId=
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

const DEFAULT_BASE_URL = 'https://api.mordn.dev';

function normalise(raw: Record<string, unknown>): Memory {
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    score: raw.score != null ? Number(raw.score) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

class HostedMemoryAdapter implements MemoryAdapter {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(
    public readonly userId: string,
    private readonly apiKey: string,
    private readonly agentId?: string,
    baseUrl: string,
    fetchImpl: typeof fetch,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
    this.doFetch = fetchImpl;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'X-Chat-User': this.userId,
      Accept: 'application/json',
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async retrieve(opts: RetrieveOptions): Promise<Memory[]> {
    try {
      const res = await this.doFetch(`${this.base}/v1/memory/query`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          ...(this.agentId ? { agentId: this.agentId } : {}),
          query: opts.query,
          limit: opts.limit,
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as { memories?: Record<string, unknown>[] } | null;
      const rows = (data?.memories ?? []).map(normalise);
      return opts.minScore != null ? rows.filter((m) => m.score == null || m.score >= opts.minScore!) : rows;
    } catch {
      return [];
    }
  }

  async record(opts: RecordOptions): Promise<void> {
    await this.doFetch(`${this.base}/v1/memory/record`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        ...(this.agentId ? { agentId: this.agentId } : {}),
        conversationId: opts.conversationId,
        messages: opts.messages,
      }),
    }).catch(() => {});
  }

  async list(): Promise<Memory[]> {
    const params = new URLSearchParams();
    if (this.agentId) params.set('agentId', this.agentId);
    const res = await this.doFetch(`${this.base}/v1/memory?${params}`, { headers: this.headers() });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as { memories?: Record<string, unknown>[] } | null;
    return (data?.memories ?? []).map(normalise);
  }

  async forget(id: string): Promise<void> {
    await this.doFetch(`${this.base}/v1/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {});
  }

  async forgetAll(): Promise<void> {
    const params = new URLSearchParams();
    if (this.agentId) params.set('agentId', this.agentId);
    await this.doFetch(`${this.base}/v1/memory?${params}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {});
  }
}

export interface HostedMemoryOptions {
  /** Tenant API key (mck_live_… / mck_test_…). Required. Never sent to the client. */
  apiKey: string;
  /**
   * Optional agent assertion for advanced multi-agent control planes. The
   * standard hosted path omits it because the API key already selects the agent.
   */
  agentId?: string;
  /** API base URL. Defaults to the hosted service; override for self-host/local. */
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetch?: typeof fetch;
  /** Per-request timeout (ms) for the hosted API. Defaults to 30s; `0` disables. */
  timeoutMs?: number;
}

/**
 * Create a `MemoryAdapterFactory` backed by the hosted @mordn/chat-api service.
 * Pass to `createChatHandler({ memory: { adapter: createHostedMemory({ apiKey, agentId }) } })`.
 */
export function createHostedMemory(options: HostedMemoryOptions): MemoryAdapterFactory {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedMemory requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (userId) => new HostedMemoryAdapter(userId, options.apiKey, options.agentId, baseUrl, fetchImpl);
}

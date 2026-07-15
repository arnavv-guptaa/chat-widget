/**
 * Hosted Knowledge retriever — a thin HTTP client over @mordn/chat-api's
 * `POST /v1/knowledge/query`. Same `Retriever` interface as the pgvector
 * default, so switching a consumer from BYO to hosted is a one-line change:
 *
 *   retrieval: {
 *     store: createHostedKnowledgeRetriever({ apiKey: process.env.MORDN_CHAT_KEY, agentId }),
 *     resolveNamespaces: () => [],   // hosted scopes by tenant+agentId server-side
 *   }
 *
 * Identity: the `apiKey` authenticates the TENANT; the server derives the tenant
 * from it and scopes every query by tenant_id + agentId. This client never
 * decides authorization — it only carries identity and the agentId.
 *
 * Namespacing note: the hosted API scopes by (tenant, agentId), so the local
 * `Namespace[]` fence is not the wire mechanism. We pass the agentId (fixed at
 * construction) and forward any resolved namespaces as a hint in the body for
 * servers that support sub-agent partitions; the security boundary is the tenant
 * key + server-side agentId scoping.
 */

import 'server-only';
import type {
  Namespace,
  QueryOptions,
  Retriever,
  RetrieverFactory,
  RetrievedChunk,
} from '../../knowledge/types';
import { withFetchTimeout, DEFAULT_HTTP_TIMEOUT_MS } from '../../http';

const DEFAULT_BASE_URL = 'https://api.mordn.com';

export interface HostedKnowledgeOptions {
  /** Tenant API key (mck_live_… / mck_test_…). Required. Never sent to the client. */
  apiKey: string;
  /** Optional agent assertion; the standard hosted key already selects the agent. */
  agentId?: string;
  /** API base URL. Defaults to the hosted service; override for self-host/local. */
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetch?: typeof fetch;
  /** Per-request timeout (ms) for the hosted API. Defaults to 30s; `0` disables. */
  timeoutMs?: number;
}

function normaliseChunk(raw: Record<string, unknown>): RetrievedChunk {
  const src = (raw.source as { url?: string; title?: string }) ?? {};
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    score: Number(raw.score ?? 0),
    source: { url: src.url, title: src.title },
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

class HostedKnowledgeRetriever implements Retriever {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string | undefined,
    baseUrl: string,
    fetchImpl: typeof fetch,
    private readonly namespaces: ReadonlyArray<Namespace>,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
    this.doFetch = fetchImpl;
  }

  async query(input: string, opts: QueryOptions = {}): Promise<RetrievedChunk[]> {
    const res = await this.doFetch(`${this.base}/v1/knowledge/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...(this.agentId ? { agentId: this.agentId } : {}),
        query: input,
        topK: opts.topK,
        minScore: opts.minScore,
        // Forward resolved namespaces as a hint; server enforces tenant+agent.
        namespaces: this.namespaces.length ? [...this.namespaces] : undefined,
      }),
    });
    // Fail soft on the read path — a retrieval hiccup must not break a turn.
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as { chunks?: Record<string, unknown>[] } | null;
    return (data?.chunks ?? []).map(normaliseChunk);
  }
}

/**
 * Create a `RetrieverFactory` backed by the hosted @mordn/chat-api service.
 * Pass to `createChatHandler({ retrieval: { store: createHostedKnowledgeRetriever({ apiKey, agentId }) } })`.
 */
export function createHostedKnowledgeRetriever(
  options: HostedKnowledgeOptions,
): RetrieverFactory {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedKnowledgeRetriever requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (namespaces) =>
    new HostedKnowledgeRetriever(options.apiKey, options.agentId, baseUrl, fetchImpl, namespaces);
}

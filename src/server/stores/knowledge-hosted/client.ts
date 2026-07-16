/**
 * Hosted Knowledge retriever — a thin HTTP client over @mordn/chat-api's
 * `POST /v1/knowledge/query`. Same `Retriever` interface as the pgvector
 * default, so switching a consumer from BYO to hosted is a one-line change:
 *
 *   retrieval: {
 *     store: createHostedKnowledgeRetriever({ apiKey: process.env.MORDN_CHAT_KEY }),
 *     resolveNamespaces: () => [],
 *   }
 *
 * Identity: the `apiKey` is an agent key (mck_live_… / mck_test_…), issued
 * per-agent from the dashboard. The server resolves both the tenant AND the
 * agent from this single credential — there is no separate agentId to
 * provide. Every query is automatically scoped to this agent's knowledge base.
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
  /** Agent API key (mck_live_… / mck_test_…), issued per-agent from the
   *  dashboard. Required. The server resolves the tenant and agent from this
   *  key — no agentId is needed or accepted. Never sent to the client. */
  apiKey: string;
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
        query: input,
        topK: opts.topK,
        minScore: opts.minScore,
        // Forward resolved namespaces as a hint; the server enforces the
        // tenant + agent scope from the API key.
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
 *
 *   createChatHandler({
 *     retrieval: {
 *       store: createHostedKnowledgeRetriever({ apiKey: process.env.MORDN_CHAT_KEY }),
 *       resolveNamespaces: () => [],
 *     },
 *   })
 *
 * The API key is an agent key — the server resolves the tenant and agent from
 * it and scopes every query to that agent's knowledge base automatically.
 */
export function createHostedKnowledgeRetriever(
  options: HostedKnowledgeOptions,
): RetrieverFactory {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedKnowledgeRetriever requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (namespaces) =>
    new HostedKnowledgeRetriever(options.apiKey, baseUrl, fetchImpl, namespaces);
}

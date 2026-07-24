/**
 * Hosted ChatStore + StorageAdapter — thin HTTP clients over the @mordn/chat-api
 * service. Same interfaces as the Drizzle/Supabase defaults, so switching a
 * consumer from BYO to hosted is a one-line change:
 *
 *   store:   createHostedChatStore({ apiKey: process.env.MORDN_CHAT_KEY })
 *   storage: createHostedStorage({ apiKey: process.env.MORDN_CHAT_KEY })
 *
 * Identity: the `apiKey` authenticates the TENANT (the customer/app). The
 * per-request `userId` the handler binds is sent as `X-Chat-User` — the end
 * user, derived from the consumer's verified session (same trust model as
 * getUserId). The hosted service enforces both axes; this client never decides
 * authorization, it only carries identity.
 */

import 'server-only';
import {
  ConversationOwnershipError,
  type ChatStore,
} from '../../chat-store';
import type { StorageAdapter, UploadInput, UploadResult } from '../../storage-adapter';
import type { ChatRequestContext, FeedbackEvent, HostedAgentConfig } from '../../handler-types';
import type {
  ListMessagesOptions,
  SaveTurnInput,
  StoredConversation,
  StoredMessage,
} from '../../types';
import { withFetchTimeout, DEFAULT_HTTP_TIMEOUT_MS } from '../../http';
import { normalizeSerializedFollowUpConfig } from '../../../utils/follow-ups';

const DEFAULT_BASE_URL = 'https://api.mordn.com';

export interface HostedOptions {
  /** Tenant API key (mck_live_… / mck_test_…). Required. Never sent to the client. */
  apiKey: string;
  /** API base URL. Defaults to the hosted service; override for self-host/local. */
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetch?: typeof fetch;
  /**
   * Per-request timeout (ms) for calls to the hosted API. A hung/stalled
   * upstream otherwise holds the request (and its connection/compute) open until
   * the platform kills it. Defaults to 30s; set `0` to disable.
   */
  timeoutMs?: number;
}

function normaliseConversation(raw: any): StoredConversation {
  return {
    id: raw.id,
    title: raw.title,
    metadata: raw.metadata ?? null,
    createdAt: new Date(raw.created_at ?? raw.createdAt),
    updatedAt: new Date(raw.updated_at ?? raw.updatedAt),
    messageCount: raw.message_count ?? raw.messageCount,
  };
}

function normaliseMessage(raw: any): StoredMessage {
  return {
    id: raw.id,
    role: raw.role,
    parts: raw.parts ?? [],
    text: raw.content ?? raw.text ?? '',
    model: raw.model ?? undefined,
    createdAt: new Date(raw.created_at ?? raw.createdAt),
  };
}

class HostedChatStore implements ChatStore {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(
    public readonly userId: string,
    private readonly apiKey: string,
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

  private async req(path: string, init?: RequestInit): Promise<Response> {
    return this.doFetch(`${this.base}/v1${path}`, init);
  }

  async listConversations(): Promise<StoredConversation[]> {
    const res = await this.req('/conversations', { headers: this.headers() });
    if (!res.ok) return [];
    // A 200 with an empty/HTML body (proxy, WAF, maintenance page) must not
    // throw and 500 the whole turn — fall through to the same soft-fail as !res.ok.
    const data = (await res.json().catch(() => null)) as { conversations?: any[] } | null;
    return (data?.conversations ?? []).map(normaliseConversation);
  }

  async getConversation(id: string): Promise<StoredConversation | null> {
    const res = await this.req(`/conversations/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    // See listConversations: a malformed 200 body must not throw.
    const data = (await res.json().catch(() => null)) as { conversation?: any } | null;
    return data?.conversation ? normaliseConversation(data.conversation) : null;
  }

  async ensureConversation(id: string): Promise<StoredConversation> {
    // The hosted API creates-or-rejects inside POST /turns (it calls
    // ensureConversation server-side). With no messages this is a cheap upsert;
    // a 403 means the conversation belongs to another user → ownership error.
    const res = await this.req(`/conversations/${encodeURIComponent(id)}/turns`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ messages: [] }),
    });
    if (res.status === 403) throw new ConversationOwnershipError(id);
    // Read it back so the contract (returns the row) holds.
    const conv = await this.getConversation(id);
    if (conv) return conv;
    // Brand-new conversation with no messages yet: synthesise the row shape.
    const now = new Date();
    return { id, title: 'New Chat', metadata: {}, createdAt: now, updatedAt: now };
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.req(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers(true),
      body: JSON.stringify({ title }),
    });
  }

  async deleteConversation(id: string): Promise<boolean> {
    const res = await this.req(`/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return res.status === 204;
  }

  async listMessages(conversationId: string, _opts?: ListMessagesOptions): Promise<StoredMessage[]> {
    const res = await this.req(`/conversations/${encodeURIComponent(conversationId)}`, { headers: this.headers() });
    if (!res.ok) return [];
    // See listConversations: a malformed 200 body must not throw.
    const data = (await res.json().catch(() => null)) as { messages?: any[] } | null;
    return (data?.messages ?? []).map(normaliseMessage);
  }

  async saveTurn(input: SaveTurnInput): Promise<void> {
    const res = await this.req(`/conversations/${encodeURIComponent(input.conversationId)}/turns`, {
      method: 'POST',
      headers: this.headers(true),
      // `usage` (token/cost) rides along when present; an older hosted API simply
      // ignores the extra field, so this stays backward-compatible.
      body: JSON.stringify({ messages: input.messages, model: input.model, usage: input.usage }),
    });
    if (res.status === 403) throw new ConversationOwnershipError(input.conversationId);
    if (!res.ok) {
      throw new Error(`[chat-widget] hosted saveTurn failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  }
}

class HostedStorageAdapter implements StorageAdapter {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(
    public readonly userId: string,
    private readonly apiKey: string,
    baseUrl: string,
    fetchImpl: typeof fetch,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
    this.doFetch = fetchImpl;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const form = new FormData();
    // Normalise to an ArrayBuffer for Blob (TS's BlobPart doesn't accept a
    // Uint8Array<ArrayBufferLike> directly under all lib configs).
    const buf: ArrayBuffer =
      input.data instanceof Uint8Array
        ? (input.data.buffer.slice(input.data.byteOffset, input.data.byteOffset + input.data.byteLength) as ArrayBuffer)
        : input.data;
    form.append('file', new Blob([buf], { type: input.mediaType }), input.filename);
    if (input.conversationId) form.append('conversationId', input.conversationId);
    const res = await this.doFetch(`${this.base}/v1/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Chat-User': this.userId },
      body: form,
    });
    if (!res.ok) throw new Error(`[chat-widget] hosted upload failed: ${res.status}`);
    // A 200 with an empty/HTML body (proxy, WAF, maintenance page) currently
    // throws uncaught and 500s the whole turn — guard it, and on a malformed
    // body fail the same way the !res.ok branch above does.
    const r = (await res.json().catch(() => null)) as UploadResult | null;
    if (!r) throw new Error(`[chat-widget] hosted upload failed: malformed response body`);
    return r;
  }

  async resign(storagePath: string): Promise<string | null> {
    // The hosted history read re-signs server-side, so a separate resign call
    // is rarely needed; expose it for parity. Returns null on any failure.
    const res = await this.doFetch(`${this.base}/v1/uploads/resign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Chat-User': this.userId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath }),
    });
    if (!res.ok) return null;
    // Malformed body → same soft-fail as !res.ok.
    const r = (await res.json().catch(() => null)) as { url?: string } | null;
    return r?.url ?? null;
  }

  async remove(storagePath: string): Promise<void> {
    await this.doFetch(`${this.base}/v1/uploads`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Chat-User': this.userId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath }),
    }).catch(() => {});
  }
}

/**
 * Create a `ChatStoreFactory` backed by the hosted @mordn/chat-api service.
 * Pass to `createChatHandler({ store: createHostedChatStore({ apiKey }) })`.
 */
export function createHostedChatStore(options: HostedOptions) {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedChatStore requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (userId: string): ChatStore => new HostedChatStore(userId, options.apiKey, baseUrl, fetchImpl);
}

/**
 * Create a `StorageAdapterFactory` backed by the hosted service.
 */
export function createHostedStorage(options: HostedOptions) {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedStorage requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  return (userId: string): StorageAdapter => new HostedStorageAdapter(userId, options.apiKey, baseUrl, fetchImpl);
}

/**
 * Create a `getHostedConfig` fetcher backed by the hosted service's
 * `GET /v1/config`. Pass to
 * `createChatHandler({ getHostedConfig: createHostedConfig({ apiKey }) })`.
 *
 * The agent is resolved server-side from the apiKey, so this returns THIS key's
 * agent config. Results are cached in-process per apiKey for a short TTL so it
 * isn't refetched every turn. Returns null on any failure → the handler falls
 * through to code/defaults (a control-plane hiccup never breaks a turn).
 */
export function createHostedConfig(options: HostedOptions) {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedConfig requires an apiKey');
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  const apiKey = options.apiKey;
  const CONFIG_TTL_MS = 60_000;
  // The GET sends `X-Chat-User: ctx.userId`, so a single keyless cache slot
  // would serve the FIRST caller's config to every user for the TTL (and
  // multiple agents sharing one apiKey would collapse into that one slot).
  // Key per userId instead. Evicted lazily on read; if the map somehow grows
  // past a sane bound (many distinct users hitting an un-recycled process),
  // clear it rather than let it grow unbounded — simplest possible cap.
  const cache = new Map<string, { value: HostedAgentConfig | null; at: number }>();
  const MAX_CACHE_ENTRIES = 200;

  return async (ctx: ChatRequestContext): Promise<HostedAgentConfig | null> => {
    const key = ctx.userId ?? '';
    const now = Date.now();
    const entry = cache.get(key);
    if (entry) {
      if (now - entry.at < CONFIG_TTL_MS) return entry.value;
      cache.delete(key);
    }

    try {
      const res = await fetchImpl(`${baseUrl}/v1/config`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'X-Chat-User': ctx.userId },
      });
      if (!res.ok) {
        cache.set(key, { value: null, at: now });
        return null;
      }
      // A 200 with an empty/HTML body (proxy, WAF, maintenance page) must not
      // throw and 500 the whole turn — fall through to the same soft-fail null.
      const raw = (await res.json().catch(() => null)) as HostedAgentConfig | null;
      if (!raw) {
        cache.set(key, { value: null, at: now });
        return null;
      }
      const appearance = raw.appearance ?? null;
      const appearanceBlob =
        appearance && typeof appearance === 'object' && !Array.isArray(appearance)
          ? (appearance as Record<string, unknown>)
          : undefined;
      // Presentational string fields ride the appearance blob rather than
      // earning a column (same call as followUps). Read the top-level field
      // first so the client survives a future API normalization that promotes
      // one out of the blob, without another release.
      const blobString = (top: unknown, key: string): string | null => {
        const v = top ?? appearanceBlob?.[key];
        return typeof v === 'string' ? v : null;
      };
      const value: HostedAgentConfig = {
        model: raw.model ?? null,
        systemPrompt: raw.systemPrompt ?? null,
        greeting: raw.greeting ?? null,
        subGreeting: blobString(raw.subGreeting, 'subGreeting'),
        assistantName: blobString(raw.assistantName, 'assistantName'),
        appearance,
        maxOutputTokens: raw.maxOutputTokens ?? null,
        followUps: normalizeSerializedFollowUpConfig(raw.followUps ?? appearanceBlob?.followUps),
      };
      if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
      cache.set(key, { value, at: now });
      return value;
    } catch {
      cache.set(key, { value: null, at: now });
      return null;
    }
  };
}

/** Options for the hosted feedback recorder. Extends the shared `HostedOptions`
 *  with the same optional `agentId` the hosted memory client accepts, so the
 *  feedback lands in the right agent namespace. Same config, no new shape. */
export interface HostedFeedbackOptions extends HostedOptions {
  /**
   * Agent namespace, sent alongside the feedback so the hosted service scopes
   * it with the tenant + user (mirrors `createHostedMemory`). Optional: omit
   * when the apiKey already resolves a single agent server-side.
   */
  agentId?: string;
}

/**
 * Create an `onFeedback` handler backed by the hosted @mordn/chat-api service.
 * Pass to `createChatHandler({ onFeedback: createHostedFeedback({ apiKey, agentId }) })`.
 *
 * This is the hosted DEFAULT for the feedback seam — the counterpart to
 * `createHostedChatStore` / `createHostedMemory`. It forwards the verified
 * feedback event to chat-api `POST /v1/feedback` using the EXACT plumbing the
 * hosted store/memory clients use: `Authorization: Bearer <apiKey>` +
 * `X-Chat-User: <verified userId>`, base URL `https://api.mordn.com` (override
 * via `baseUrl`), JSON body. The `apiKey` authenticates the tenant; the userId
 * the handler resolved server-side rides in `X-Chat-User` — the browser never
 * holds the secret and never asserts the identity.
 *
 * Best-effort to match the handler's contract: any network/HTTP failure is
 * swallowed (the handler already guarantees feedback never 500s a turn), so a
 * telemetry hiccup can't break the widget.
 */
export function createHostedFeedback(options: HostedFeedbackOptions) {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedFeedback requires an apiKey');
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = withFetchTimeout(options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  const apiKey = options.apiKey;
  const agentId = options.agentId;

  return async (feedback: FeedbackEvent, _ctx: ChatRequestContext): Promise<void> => {
    try {
      const res = await fetchImpl(`${base}/v1/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Chat-User': feedback.userId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(agentId ? { agentId } : {}),
          conversationId: feedback.conversationId,
          messageId: feedback.messageId,
          rating: feedback.rating,
          ...(feedback.reason ? { reason: feedback.reason } : {}),
        }),
      });
      if (!res.ok) {
        // Non-2xx is swallowed — the handler's response is already `{ ok:true }`.
        console.debug('[chat-widget] hosted feedback POST rejected:', res.status);
      }
    } catch (err) {
      // Network failure — best-effort, never surfaces to the user.
      console.debug('[chat-widget] hosted feedback POST failed:', err);
    }
  };
}

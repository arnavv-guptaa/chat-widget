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
import type { ChatRequestContext, HostedAgentConfig } from '../../handler-types';
import type {
  ListMessagesOptions,
  SaveTurnInput,
  StoredConversation,
  StoredMessage,
} from '../../types';

const DEFAULT_BASE_URL = 'https://api.mordn.dev';

export interface HostedOptions {
  /** Tenant API key (mck_live_… / mck_test_…). Required. Never sent to the client. */
  apiKey: string;
  /** API base URL. Defaults to the hosted service; override for self-host/local. */
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetch?: typeof fetch;
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
    const data = (await res.json()) as { conversations?: any[] };
    return (data.conversations ?? []).map(normaliseConversation);
  }

  async getConversation(id: string): Promise<StoredConversation | null> {
    const res = await this.req(`/conversations/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { conversation?: any };
    return data.conversation ? normaliseConversation(data.conversation) : null;
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
    const data = (await res.json()) as { messages?: any[] };
    return (data.messages ?? []).map(normaliseMessage);
  }

  async saveTurn(input: SaveTurnInput): Promise<void> {
    const res = await this.req(`/conversations/${encodeURIComponent(input.conversationId)}/turns`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ messages: input.messages, model: input.model }),
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
    const r = (await res.json()) as UploadResult;
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
    const r = (await res.json()) as { url?: string };
    return r.url ?? null;
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
  const fetchImpl = options.fetch ?? fetch;
  return (userId: string): ChatStore => new HostedChatStore(userId, options.apiKey, baseUrl, fetchImpl);
}

/**
 * Create a `StorageAdapterFactory` backed by the hosted service.
 */
export function createHostedStorage(options: HostedOptions) {
  if (!options.apiKey) throw new Error('[chat-widget] createHostedStorage requires an apiKey');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetch ?? fetch;
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
  const fetchImpl = options.fetch ?? fetch;
  const apiKey = options.apiKey;
  const CONFIG_TTL_MS = 60_000;

  let cached: { value: HostedAgentConfig | null; at: number } | null = null;

  return async (ctx: ChatRequestContext): Promise<HostedAgentConfig | null> => {
    const now = Date.now();
    if (cached && now - cached.at < CONFIG_TTL_MS) return cached.value;

    try {
      const res = await fetchImpl(`${baseUrl}/v1/config`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'X-Chat-User': ctx.userId },
      });
      if (!res.ok) {
        cached = { value: null, at: now };
        return null;
      }
      const raw = (await res.json()) as HostedAgentConfig;
      const value: HostedAgentConfig = {
        model: raw.model ?? null,
        systemPrompt: raw.systemPrompt ?? null,
        greeting: raw.greeting ?? null,
        appearance: raw.appearance ?? null,
      };
      cached = { value, at: now };
      return value;
    } catch {
      cached = { value: null, at: now };
      return null;
    }
  };
}

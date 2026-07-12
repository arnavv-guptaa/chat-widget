import 'server-only';

import { createChatHandler } from '../../handler';
import type { CreateChatHandlerOptions } from '../../handler-types';
import { DEFAULT_HTTP_TIMEOUT_MS, withFetchTimeout } from '../../http';
import { connectMcpTools, type McpServerConfig } from '../../mcp';
import { createHostedKnowledgeRetriever } from '../knowledge-hosted/client';
import { createHostedMemory } from '../memory-hosted/client';
import {
  createHostedChatStore,
  createHostedConfig,
  createHostedFeedback,
  createHostedStorage,
  type HostedOptions,
} from './store';

export type MordnAdvancedOptions = Omit<
  CreateChatHandlerOptions,
  'getUserId' | 'store' | 'storage' | 'getHostedConfig'
>;

export type CreateMordnHandlerOptions = HostedOptions &
  { getUserId: CreateChatHandlerOptions['getUserId'] } &
  MordnAdvancedOptions;

async function hmacStorageScope(apiKey: string, agent: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`mordn-storage-scope-v1\u0000${agent}\u0000${userId}`),
  );
  return Array.from(new Uint8Array(signature).slice(0, 18), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Standard hosted façade: one API key wires published config, persistence,
 * attachments, and feedback while model execution continues in this handler.
 * Browser storage uses a stable HMAC scope keyed by that server-only apiKey;
 * advanced callers can explicitly replace the resolver when needed.
 */
export function createMordnHandler(options: CreateMordnHandlerOptions) {
  const { apiKey, baseUrl, fetch: fetchOption, timeoutMs, getUserId, ...advancedOptions } = options;
  const hosted = { apiKey, baseUrl, fetch: fetchOption, timeoutMs };
  const hostedBaseUrl = (baseUrl ?? 'https://api.mordn.dev').replace(/\/$/, '');
  const doFetch = withFetchTimeout(
    fetchOption ?? globalThis.fetch,
    timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
  );
  return createChatHandler({
    ...advancedOptions,
    getUserId,
    store: createHostedChatStore(hosted),
    storage: createHostedStorage(hosted),
    getHostedConfig: createHostedConfig(hosted),
    retrieval:
      advancedOptions.retrieval ??
      ({
        store: createHostedKnowledgeRetriever(hosted),
        resolveNamespaces: () => [],
      } as NonNullable<CreateChatHandlerOptions['retrieval']>),
    memory:
      advancedOptions.memory ??
      ({ adapter: createHostedMemory(hosted) } as NonNullable<CreateChatHandlerOptions['memory']>),
    buildTools:
      advancedOptions.buildTools ??
      (async () => {
        try {
          const response = await doFetch(`${hostedBaseUrl}/v1/mcp/connect`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: 'no-store',
          });
          if (!response.ok) return { tools: {} };
          const body = (await response.json().catch(() => null)) as {
            servers?: McpServerConfig[];
          } | null;
          if (!body?.servers?.length) return { tools: {} };
          return connectMcpTools(body.servers);
        } catch {
          return { tools: {} };
        }
      }),
    resolveStorageScope:
      advancedOptions.resolveStorageScope ??
      ((ctx, agent) => hmacStorageScope(apiKey, agent, ctx.userId)),
    onFeedback: advancedOptions.onFeedback ?? createHostedFeedback(hosted),
  });
}

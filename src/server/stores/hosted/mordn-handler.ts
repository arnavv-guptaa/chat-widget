import 'server-only';

import { createChatHandler } from '../../handler';
import type { BuiltTools, ChatRequestContext, CreateChatHandlerOptions } from '../../handler-types';
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

/**
 * Standard hosted façade: one API key wires published config, persistence,
 * attachments, feedback, knowledge, memory, and agent MCP tools while model
 * execution continues in this handler.
 *
 * Tools are MERGED, not either/or: developer `buildTools(ctx)` runs alongside
 * the hosted MCP connect, with developer tools winning on a name clash
 * (code > hosted). Both cleanups run, each isolated from the other.
 *
 * Browser storage scoping uses the handler's default resolver — an opaque
 * digest of the server-resolved agent + verified user — so rotating the API
 * key never changes end users' storage namespace. Advanced callers can still
 * pass `resolveStorageScope` explicitly.
 */
export function createMordnHandler(options: CreateMordnHandlerOptions) {
  const { apiKey, baseUrl, fetch: fetchOption, timeoutMs, getUserId, ...advancedOptions } = options;
  const hosted = { apiKey, baseUrl, fetch: fetchOption, timeoutMs };
  const hostedBaseUrl = (baseUrl ?? 'https://api.mordn.com').replace(/\/$/, '');
  const doFetch = withFetchTimeout(
    fetchOption ?? globalThis.fetch,
    timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
  );

  // Best-effort hosted MCP connect: a control-plane hiccup yields zero hosted
  // tools for the turn, never an error into the chat.
  async function connectHostedTools(): Promise<BuiltTools> {
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
  }

  const customBuildTools = advancedOptions.buildTools;

  async function buildMergedTools(ctx: ChatRequestContext): Promise<BuiltTools> {
    const [custom, hostedTools] = await Promise.all([
      Promise.resolve(customBuildTools ? customBuildTools(ctx) : { tools: {} as BuiltTools['tools'] }),
      connectHostedTools(),
    ]);
    return {
      // Developer tools win on a name clash: code > hosted, same precedence
      // the handler applies to model and system prompt.
      tools: { ...hostedTools.tools, ...custom.tools },
      cleanup: async () => {
        // Run BOTH cleanups even if one throws — a failing custom cleanup must
        // not leak hosted MCP connections, and vice versa.
        const settled = await Promise.allSettled([
          Promise.resolve(custom.cleanup?.()),
          Promise.resolve(hostedTools.cleanup?.()),
        ]);
        for (const result of settled) {
          if (result.status === 'rejected') {
            console.error('[chat-widget] mordn tool cleanup failed:', result.reason);
          }
        }
      },
    };
  }

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
    buildTools: buildMergedTools,
    onFeedback: advancedOptions.onFeedback ?? createHostedFeedback(hosted),
  });
}

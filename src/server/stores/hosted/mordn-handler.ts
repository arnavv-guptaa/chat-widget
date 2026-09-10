import 'server-only';

import { createChatHandler } from '../../handler';
import type { BuiltTools, ChatRequestContext, CreateChatHandlerOptions } from '../../handler-types';
import { DEFAULT_HTTP_TIMEOUT_MS, withFetchTimeout } from '../../http';
import { connectMcpTools, type McpServerConfig } from '../../mcp';
import { createToolResourceScope } from '../../tool-resources';
import { createHostedSandboxes } from './sandboxes';
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
 * attachments, feedback, knowledge, memory, agent MCP tools and optional managed
 * sandboxes while model execution continues in this handler.
 *
 * Tools are MERGED, not either/or: developer `buildTools(ctx)` runs alongside
 * the hosted MCP connect, with developer tools winning on a name clash
 * (code > hosted). Both cleanups run, each isolated from the other. Enabled
 * managed sandboxes additionally reserve their six sandbox_* names; they cannot
 * be shadowed by a custom tool that has not verified an artifact's provenance.
 *
 * Browser storage scoping uses the handler's default resolver — an opaque
 * digest of the server-resolved agent + verified user — so rotating the API
 * key never changes end users' storage namespace. Advanced callers can still
 * pass `resolveStorageScope` explicitly.
 */
export function createMordnHandler(options: CreateMordnHandlerOptions) {
  const { apiKey, baseUrl, selfBaseUrl, fetch: fetchOption, timeoutMs, getUserId, ...advancedOptions } = options;
  const hosted = { apiKey, baseUrl, selfBaseUrl, fetch: fetchOption, timeoutMs };
  const hostedBaseUrl = (baseUrl ?? 'https://api.mordn.com').replace(/\/$/, '');
  const doFetch = withFetchTimeout(
    fetchOption ?? globalThis.fetch,
    timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
  );

  // Best-effort hosted MCP connect: a control-plane hiccup yields zero hosted
  // tools for the turn, never an error into the chat.
  async function connectHostedTools(ctx: ChatRequestContext): Promise<BuiltTools> {
    try {
      const response = await doFetch(`${hostedBaseUrl}/v1/mcp/connect`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
        signal: ctx.abortSignal ?? ctx.request.signal,
      });
      if (!response.ok) return { tools: {} };
      const body = (await response.json().catch(() => null)) as {
        servers?: McpServerConfig[];
      } | null;
      if (!body?.servers?.length) return { tools: {} };
      // selfBaseUrl deliberately does NOT relax arbitrary MCP SSRF guards.
      return connectMcpTools(body.servers, { signal: ctx.abortSignal ?? ctx.request.signal });
    } catch {
      return { tools: {} };
    }
  }

  const customBuildTools = advancedOptions.buildTools;

  async function buildMergedTools(ctx: ChatRequestContext): Promise<BuiltTools> {
    const resources = createToolResourceScope(() => {
      console.error('[chat-widget] mordn tool cleanup failed');
    });
    const signal = ctx.abortSignal ?? ctx.request.signal;
    const onAbort = () => { void resources.cleanup(); };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = async () => {
      signal.removeEventListener('abort', onAbort);
      await resources.cleanup();
    };
    try {
      // Adopt each result as it arrives. Promise.all rejection must not leak
      // the other connection, even if it arrives after the failure/abort.
      const [custom, hostedTools] = await Promise.all([
        Promise.resolve().then(() => customBuildTools ? customBuildTools(ctx) : { tools: {} })
          .then((built) => resources.adopt(built)),
        connectHostedTools(ctx).then((built) => resources.adopt(built)),
      ]);
      signal.throwIfAborted();
      return { tools: { ...hostedTools.tools, ...custom.tools }, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  return createChatHandler({
    ...advancedOptions,
    getUserId,
    store: createHostedChatStore(hosted),
    storage: createHostedStorage(hosted),
    getHostedConfig: createHostedConfig(hosted),
    sandboxes: advancedOptions.sandboxes ?? createHostedSandboxes(hosted),
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

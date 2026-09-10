/**
 * MCP (Model Context Protocol) tool wiring for the chat handler.
 *
 * Lets an agent expose tools from one or more remote MCP servers — both a curated
 * catalog of supported integrations and arbitrary custom servers a developer (or
 * their end-user) connects. Each configured server is connected per request, its
 * tools merged into the turn's tool set, and the client closed when the request
 * settles.
 *
 * This plugs into the handler's existing `buildTools` seam: `connectMcpTools`
 * returns `{ tools, cleanup }` (the BuiltTools shape), so the handler's
 * once-only teardown closes every MCP client on finish / error / abort. No
 * handler changes are needed — MCP is just a tool source.
 *
 *   createChatHandler({
 *     buildTools: async (ctx) => connectMcpTools(await resolveAgentMcpServers(ctx)),
 *   })
 *
 * Transport: HTTP (StreamableHTTP) or SSE remote servers only — stdio is a local
 * subprocess and has no place in a hosted multi-tenant backend. Per-server
 * headers carry auth (e.g. an end-user's token). Connection failures are
 * isolated: one bad server never blocks the others or the turn.
 *
 * SECURITY:
 *   • SSRF — every server URL is validated with the shared `assertPublicHttpUrl`
 *     guard (http/https only; private/loopback/link-local/cloud-metadata hosts
 *     blocked, including hostnames that RESOLVE to them) BEFORE the client
 *     connects, so a user- or developer-supplied URL can't be used to reach the
 *     internal network. Pass `{ allowPrivateHosts: true }` only when you
 *     intentionally connect to an internal MCP server you control.
 *   • Untrusted output — a remote server's tool descriptions AND results are
 *     UNTRUSTED model input; a malicious/compromised server can attempt prompt
 *     injection through them. The handler keeps the operator's system prompt
 *     authoritative and tool names are namespaced per server, but operators
 *     should still only wire MCP servers they trust for a given agent.
 */

import { createMCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { assertPublicHttpUrl } from './net-guard';

export type McpTransport = 'http' | 'sse';

export interface McpServerConfig {
  /** Stable id (also used to namespace this server's tool names). */
  id: string;
  /** Human label (catalog name or user-given name). */
  label?: string;
  /** Remote endpoint. */
  url: string;
  /** http = StreamableHTTP (default), sse = Server-Sent Events. */
  transport?: McpTransport;
  /** Auth / custom headers (e.g. { Authorization: 'Bearer …' }). */
  headers?: Record<string, string>;
  /**
   * Prefix this server's tool names with `${id}_` to avoid collisions when
   * several servers expose a tool of the same name. Default true.
   */
  namespaceTools?: boolean;
}

export interface ConnectedMcp {
  /** Merged tools across all servers that connected successfully. */
  tools: ToolSet;
  /** Close every connected client. Idempotent; safe to call once. */
  cleanup: () => Promise<void>;
  /** Per-server connection outcome (for logging/telemetry). */
  results: { id: string; ok: boolean; toolCount: number; error?: string }[];
}

// Prefix tool names so two servers can both expose e.g. "search" without clobber.
// `client.tools()` returns a tool record whose value type is more specific than
// ToolSet's; keep it generic and re-key, casting back to ToolSet at the boundary
// (the values are structurally valid tools the model loop accepts).
function namespaced<T extends Record<string, unknown>>(tools: T, prefix: string): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) out[`${prefix}_${name}`] = tool;
  return out as ToolSet;
}

/**
 * Connect every configured MCP server, merge their tools, and return a BuiltTools
 * `{ tools, cleanup }`. Best-effort: a server that fails to connect is skipped
 * (recorded in `results`) — it never throws into the turn. `cleanup` closes all
 * clients and is safe to call exactly once (the handler guarantees that).
 */
export interface ConnectMcpOptions {
  /**
   * Allow MCP servers on PRIVATE/internal hosts — skips the SSRF guard's
   * private-range checks (the http/https scheme check still applies). OFF by
   * default, the safe multi-tenant posture where server URLs may be developer-
   * or end-user-supplied. Enable only when you INTENTIONALLY connect to internal
   * MCP servers you control.
   */
  allowPrivateHosts?: boolean;
  /** Trusted server-side transport override (e.g. scoped hosted HTTP + timeout). */
  fetch?: typeof fetch;
  /** Abort discovery/execution and close connections, never remote workspaces. */
  signal?: AbortSignal;
}

export async function connectMcpTools(
  servers: McpServerConfig[],
  opts: ConnectMcpOptions = {},
): Promise<ConnectedMcp> {
  const clients: { close: () => Promise<void> }[] = [];
  const results: ConnectedMcp['results'] = [];
  let tools: ToolSet = {};
  let cleaned = false;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    cleaned = true;
    opts.signal?.removeEventListener('abort', onAbort);
    cleanupPromise = Promise.all(clients.map((client) => client.close())).then(() => {});
    return cleanupPromise;
  };
  const onAbort = () => { void cleanup(); };
  if (opts.signal?.aborted) await cleanup();
  else opts.signal?.addEventListener('abort', onAbort, { once: true });
  const transportFetch: typeof fetch | undefined = opts.fetch || opts.signal
    ? (input, init) => (opts.fetch ?? globalThis.fetch)(input, {
        ...init,
        ...(opts.signal ? { signal: init?.signal
          ? AbortSignal.any([opts.signal, init.signal]) : opts.signal } : {}),
      })
    : undefined;

  // Connect in parallel; isolate failures per server.
  await Promise.all(
    (servers ?? []).map(async (server) => {
      if (!server?.url || !server?.id) {
        results.push({ id: server?.id ?? '(unknown)', ok: false, toolCount: 0, error: 'missing id/url' });
        return;
      }
      // SSRF guard: reject non-http(s) schemes and private/internal/metadata
      // endpoints BEFORE the client dials a (possibly user-supplied) URL.
      try {
        await assertPublicHttpUrl(server.url, { allowPrivate: opts.allowPrivateHosts });
      } catch (err) {
        results.push({
          id: server.id,
          ok: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : 'blocked url',
        });
        return;
      }
      let resource: { close: () => Promise<void> } | undefined;
      try {
        opts.signal?.throwIfAborted();
        if (cleaned) throw new Error('MCP connection already closed');
        const client = await createMCPClient({
          transport: {
            type: server.transport ?? 'http',
            url: server.url,
            ...(server.headers ? { headers: server.headers } : {}),
            ...(transportFetch ? { fetch: transportFetch } : {}),
          },
        });
        let closePromise: Promise<void> | undefined;
        resource = { close: () => closePromise ??= Promise.resolve().then(() => client.close()).catch(() => {
          // Never log a transport error that may include auth headers or URLs.
          console.error('[chat-widget] MCP client close failed');
        }) };
        clients.push(resource);
        // An abort can win while createMCPClient is resolving. A late connection
        // still gets its one close; it cannot escape the earlier cleanup pass.
        if (cleaned || opts.signal?.aborted) {
          await resource.close();
          throw new Error('MCP connection aborted');
        }
        const serverTools = await client.tools();
        opts.signal?.throwIfAborted();
        const merged =
          server.namespaceTools === false ? (serverTools as ToolSet) : namespaced(serverTools, server.id);
        tools = { ...tools, ...merged };
        results.push({ id: server.id, ok: true, toolCount: Object.keys(serverTools).length });
      } catch (err) {
        // Tool discovery failure must not retain a connected client until some
        // caller remembers to clean up a failed server.
        await resource?.close();
        results.push({
          id: server.id,
          ok: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return { tools: cleaned ? {} : tools, cleanup, results };
}

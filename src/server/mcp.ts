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
 */

import { createMCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';

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
export async function connectMcpTools(servers: McpServerConfig[]): Promise<ConnectedMcp> {
  const clients: { close: () => Promise<void> }[] = [];
  const results: ConnectedMcp['results'] = [];
  let tools: ToolSet = {};

  // Connect in parallel; isolate failures per server.
  await Promise.all(
    (servers ?? []).map(async (server) => {
      if (!server?.url || !server?.id) {
        results.push({ id: server?.id ?? '(unknown)', ok: false, toolCount: 0, error: 'missing id/url' });
        return;
      }
      try {
        const client = await createMCPClient({
          transport: {
            type: server.transport ?? 'http',
            url: server.url,
            ...(server.headers ? { headers: server.headers } : {}),
          },
        });
        clients.push(client);
        const serverTools = await client.tools();
        const merged =
          server.namespaceTools === false ? (serverTools as ToolSet) : namespaced(serverTools, server.id);
        tools = { ...tools, ...merged };
        results.push({ id: server.id, ok: true, toolCount: Object.keys(serverTools).length });
      } catch (err) {
        results.push({
          id: server.id,
          ok: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await Promise.all(
      clients.map((c) =>
        Promise.resolve(c.close()).catch((err) =>
          console.error('[chat-widget] MCP client close failed:', err instanceof Error ? err.message : err),
        ),
      ),
    );
  };

  return { tools, cleanup, results };
}

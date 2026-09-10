import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatHandler } from '../src/server/handler';
import { createMordnHandler } from '../src/server/stores/hosted/mordn-handler';
import { connectMcpTools } from '../src/server/mcp';
import type { ChatRequestContext } from '../src/server/handler-types';

vi.mock('../src/server/handler', () => ({ createChatHandler: vi.fn(() => ({})) }));
vi.mock('../src/server/mcp', () => ({ connectMcpTools: vi.fn() }));
const ctx: ChatRequestContext = { userId: 'verified', conversationId: 'c', request: new Request('https://app.example/chat') };
const fetchApi = () => vi.fn(async () => new Response(JSON.stringify({ servers: [{ id: 'other', url: 'https://mcp.example/tools' }] }), { headers: { 'content-type': 'application/json' } }));
beforeEach(() => vi.clearAllMocks());

describe('createMordnHandler managed adapter wiring', () => {
  it('automatically installs the lazy helper and preserves an explicit false opt-out', () => {
    const fetch = fetchApi();
    createMordnHandler({ apiKey: 'key', getUserId: () => 'verified', fetch });
    expect(vi.mocked(createChatHandler).mock.calls[0][0].sandboxes).toMatchObject({ kind: 'mordn-managed' });
    expect(fetch).not.toHaveBeenCalled(); expect(connectMcpTools).not.toHaveBeenCalled();
    createMordnHandler({ apiKey: 'key', getUserId: () => 'verified', fetch, sandboxes: false });
    expect(vi.mocked(createChatHandler).mock.calls[1][0].sandboxes).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps other hosted MCP + custom tools and cleans each exactly once, even on cleanup throw', async () => {
    const hostedCleanup = vi.fn(async () => {});
    const customCleanup = vi.fn(() => { throw new Error('failure'); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(connectMcpTools).mockResolvedValue({ tools: { hosted: { inputSchema: {} } } as never, cleanup: hostedCleanup, results: [] });
    createMordnHandler({
      apiKey: 'key', getUserId: () => 'verified', fetch: fetchApi(), selfBaseUrl: 'http://127.0.0.1:3000',
      buildTools: () => ({ tools: { custom: { inputSchema: {} } } as never, cleanup: customCleanup }),
    });
    const options = vi.mocked(createChatHandler).mock.calls[0][0];
    const built = await options.buildTools!(ctx);
    expect(Object.keys(built.tools).sort()).toEqual(['custom', 'hosted']);
    await Promise.all([built.cleanup!(), built.cleanup!()]);
    expect(customCleanup).toHaveBeenCalledOnce(); expect(hostedCleanup).toHaveBeenCalledOnce();
    // Only the dedicated helper may opt in to self loopback. Ordinary remote
    // servers from /mcp/connect retain their default SSRF policy.
    expect(vi.mocked(connectMcpTools).mock.calls[0][1]).not.toHaveProperty('allowPrivateHosts');
    consoleError.mockRestore();
  });

  it('adopts and cleans a late hosted connection when custom buildTools fails first', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const cleanup = vi.fn(async () => {});
    vi.mocked(connectMcpTools).mockImplementation(async () => {
      await gate;
      return { tools: {}, cleanup, results: [] };
    });
    createMordnHandler({ apiKey: 'key', getUserId: () => 'verified', fetch: fetchApi(), buildTools: () => { throw new Error('custom setup'); } });
    await expect(vi.mocked(createChatHandler).mock.calls[0][0].buildTools!(ctx)).rejects.toThrow('custom setup');
    release();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });
});

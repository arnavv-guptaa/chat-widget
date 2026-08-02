import { describe, it, expect } from 'vitest';
import { createHostedChatStore } from '../src/server/stores/hosted/store';

/**
 * A fake hosted API. `honoursQuery` models the two chat-api versions a widget
 * can find itself talking to:
 *
 *  - `true`  — a current API that applies `?before=&limit=` server-side
 *  - `false` — an older API that ignores them and returns the whole thread
 *
 * The widget must produce an identical page in both cases. That is the whole
 * point of re-applying the window client-side: the widget and chat-api ship on
 * independent release trains, so correctness cannot depend on deploy order.
 */
function fakeApi(options: { total: number; honoursQuery: boolean }) {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const all = Array.from({ length: options.total }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text: `message ${i}` }],
    content: `message ${i}`,
    // One message per minute, oldest first.
    created_at: new Date(base + i * 60_000).toISOString(),
  }));

  const calls: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push(url);

    let messages = all;
    if (options.honoursQuery) {
      const before = url.searchParams.get('before');
      if (before) messages = messages.filter((m) => Date.parse(m.created_at) < Date.parse(before));
      const limit = Number(url.searchParams.get('limit'));
      if (Number.isFinite(limit) && limit > 0) messages = messages.slice(-limit);
    }
    return new Response(JSON.stringify({ conversation: { id: 'c-1' }, messages }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, all };
}

const storeFor = (fetchImpl: typeof fetch) =>
  createHostedChatStore({ apiKey: 'mck_test_x', baseUrl: 'https://api.test', fetch: fetchImpl })('u-1');

describe('HostedChatStore.listMessages — forwarding', () => {
  it('sends limit and before as query params', async () => {
    const api = fakeApi({ total: 10, honoursQuery: true });
    await storeFor(api.fetchImpl).listMessages('c-1', {
      limit: 5,
      before: new Date('2026-01-01T00:07:00.000Z'),
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].searchParams.get('limit')).toBe('5');
    expect(api.calls[0].searchParams.get('before')).toBe('2026-01-01T00:07:00.000Z');
  });

  it('omits before on the first page', async () => {
    const api = fakeApi({ total: 10, honoursQuery: true });
    await storeFor(api.fetchImpl).listMessages('c-1', { limit: 5 });
    expect(api.calls[0].searchParams.has('before')).toBe(false);
  });

  it('clamps limit to 101 — the ceiling plus the router hasMore probe row', async () => {
    const api = fakeApi({ total: 10, honoursQuery: true });
    await storeFor(api.fetchImpl).listMessages('c-1', { limit: 100_000 });
    expect(api.calls[0].searchParams.get('limit')).toBe('101');
  });

  it('still requests at least one message for a nonsense limit', async () => {
    const api = fakeApi({ total: 10, honoursQuery: true });
    await storeFor(api.fetchImpl).listMessages('c-1', { limit: 0 });
    expect(Number(api.calls[0].searchParams.get('limit'))).toBeGreaterThanOrEqual(1);
  });
});

describe('HostedChatStore.listMessages — windowing is correct against BOTH API versions', () => {
  for (const honoursQuery of [true, false]) {
    const label = honoursQuery ? 'a current API' : 'an older API that ignores the query';

    it(`returns the newest page in chronological order against ${label}`, async () => {
      const api = fakeApi({ total: 200, honoursQuery });
      const page = await storeFor(api.fetchImpl).listMessages('c-1', { limit: 30 });

      expect(page).toHaveLength(30);
      expect(page[0].id).toBe('m-170');
      expect(page[29].id).toBe('m-199');
      // Chronological, oldest → newest.
      for (let i = 1; i < page.length; i++) {
        expect(page[i].createdAt.getTime()).toBeGreaterThanOrEqual(page[i - 1].createdAt.getTime());
      }
    });

    it(`applies before as a STRICT inequality against ${label}`, async () => {
      const api = fakeApi({ total: 200, honoursQuery });
      // m-100's own timestamp — it must NOT come back, or "load older" loops.
      const boundary = new Date(Date.parse('2026-01-01T00:00:00.000Z') + 100 * 60_000);
      const page = await storeFor(api.fetchImpl).listMessages('c-1', { limit: 10, before: boundary });

      expect(page.map((m) => m.id)).not.toContain('m-100');
      expect(page[page.length - 1].id).toBe('m-99');
      expect(page).toHaveLength(10);
    });

    it(`returns everything when the thread is shorter than the page against ${label}`, async () => {
      const api = fakeApi({ total: 7, honoursQuery });
      const page = await storeFor(api.fetchImpl).listMessages('c-1', { limit: 30 });
      expect(page).toHaveLength(7);
      expect(page[0].id).toBe('m-0');
    });
  }
});

describe('HostedChatStore.listMessages — resilience', () => {
  it('normalises order even when the API returns newest-first', async () => {
    const reversed = (async () =>
      new Response(
        JSON.stringify({
          messages: [
            { id: 'b', role: 'assistant', parts: [], created_at: '2026-01-01T00:05:00.000Z' },
            { id: 'a', role: 'user', parts: [], created_at: '2026-01-01T00:01:00.000Z' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const page = await storeFor(reversed).listMessages('c-1', { limit: 10 });
    expect(page.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not throw on an unparseable timestamp', async () => {
    const bad = (async () =>
      new Response(
        JSON.stringify({
          messages: [
            { id: 'ok', role: 'user', parts: [], created_at: '2026-01-01T00:01:00.000Z' },
            { id: 'bad', role: 'assistant', parts: [], created_at: 'not-a-date' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const page = await storeFor(bad).listMessages('c-1', { limit: 10 });
    // Undated rows sort to the front so they can never displace real messages
    // off the newest page.
    expect(page.map((m) => m.id)).toEqual(['bad', 'ok']);
  });

  it('soft-fails to [] on a non-OK response rather than throwing', async () => {
    const failing = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(storeFor(failing).listMessages('c-1', { limit: 10 })).resolves.toEqual([]);
  });

  it('soft-fails to [] on a malformed 200 body (WAF / maintenance page)', async () => {
    const html = (async () => new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(storeFor(html).listMessages('c-1', { limit: 10 })).resolves.toEqual([]);
  });
});

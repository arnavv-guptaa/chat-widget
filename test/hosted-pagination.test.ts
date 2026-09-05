import { describe, it, expect } from 'vitest';
import './hosted-history-contract.mjs';
import { createHostedChatStore } from '../src/server/stores/hosted/store';
import { HISTORY_PAGINATION, HISTORY_PAGINATION_HEADER } from '../src/server/stores/hosted/history';

// Production legacy behavior is NOT all rows: it ignores every query parameter
// and always returns newest 100. >100 equal timestamps catch the old fallback.
function fakeApi(mode: 'tuple' | 'fixed-newest-100' | 'timestamp-only', total = 337) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `m-${String(i).padStart(4, '0')}`,
    role: 'user',
    parts: [{ type: 'text', text: `message ${i}` }],
    content: `message ${i}`,
    // 140-row tie groups exceed even the 101-row probe.
    created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 140) * 1000).toISOString(),
  }));
  const calls: { url: URL; headers: Headers }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    let messages = all;
    if (mode === 'fixed-newest-100') messages = all.slice(-100);
    else {
      const before = url.searchParams.get('before');
      const id = mode === 'tuple' ? url.searchParams.get('beforeId') : null;
      if (before) messages = messages.filter((m) => m.created_at < before || (m.created_at === before && id !== null && m.id < id));
      messages = messages.slice(-Number(url.searchParams.get('limit') ?? 100));
    }
    return new Response(JSON.stringify({ conversation: { id: 'c-1' }, messages }), {
      headers: mode === 'tuple' ? { [HISTORY_PAGINATION_HEADER]: HISTORY_PAGINATION } : {},
    });
  }) as typeof fetch;
  return { all, calls, fetchImpl };
}
const storeFor = (fetchImpl: typeof fetch) => createHostedChatStore({ apiKey: 'mck_test_x', baseUrl: 'https://api.test', fetch: fetchImpl })('verified-user');

describe('hosted tuple history protocol', () => {
  it('forwards the tuple, bounded limit and version; preserves verified identity', async () => {
    const api = fakeApi('tuple');
    await storeFor(api.fetchImpl).listMessages('c/1', { limit: 31, before: new Date(api.all[200].created_at), beforeId: api.all[200].id });
    const { url, headers } = api.calls[0];
    expect(url.pathname).toBe('/v1/conversations/c%2F1');
    expect(Object.fromEntries(url.searchParams)).toEqual({ historyPagination: HISTORY_PAGINATION, limit: '31', before: api.all[200].created_at, beforeId: api.all[200].id });
    expect(headers.get('X-Chat-User')).toBe('verified-user');
    expect(headers.get('Authorization')).toBe('Bearer mck_test_x');
  });

  for (const pageSize of [1, 30, 100]) {
    it(`walks >100 messages/ties with ${pageSize}+1 probes, no gaps or duplicates`, async () => {
      const api = fakeApi('tuple');
      const store = storeFor(api.fetchImpl);
      let before: Date | undefined;
      let beforeId: string | undefined;
      let ids: string[] = [];
      for (let attempts = 0; attempts < 400; attempts++) {
        const page = await store.listMessages('c-1', { limit: pageSize + 1, before, beforeId });
        const hasMore = page.length > pageSize;
        const visible = hasMore ? page.slice(-pageSize) : page;
        ids = [...visible.map((m) => m.id), ...ids];
        if (!hasMore) break;
        before = visible[0].createdAt;
        beforeId = visible[0].id;
      }
      expect(ids).toEqual(api.all.map((m) => m.id));
      expect(new Set(ids).size).toBe(api.all.length);
      expect(api.calls.every(({ url }) => Number(url.searchParams.get('limit')) <= 101)).toBe(true);
    });
  }

  for (const mode of ['fixed-newest-100', 'timestamp-only'] as const) {
    it(`fails closed on ${mode}, including the first 101-row hasMore probe`, async () => {
      const api = fakeApi(mode);
      const store = storeFor(api.fetchImpl);
      await expect(store.listMessages('c-1', { limit: 101 })).rejects.toThrow('lacks created-at-id-v1');
      await expect(store.listMessages('c-1', { limit: 31, before: new Date(api.all[150].created_at), beforeId: api.all[150].id })).rejects.toThrow('lacks created-at-id-v1');
      expect(api.calls).toHaveLength(2); // no retries, broad query or all-rows fallback
      expect(api.calls.every(({ url }) => url.searchParams.has('limit'))).toBe(true);
    });
  }

  it('checks every response instead of trusting a cached capability after rollback', async () => {
    const current = fakeApi('tuple');
    const old = fakeApi('fixed-newest-100');
    let first = true;
    const fetchImpl = (async (input, init) => {
      const api = first ? current : old;
      first = false;
      return api.fetchImpl(input, init);
    }) as typeof fetch;
    const store = storeFor(fetchImpl);
    const page = await store.listMessages('c-1', { limit: 31 });
    await expect(store.listMessages('c-1', { limit: 31, before: page[0].createdAt, beforeId: page[0].id })).rejects.toThrow('lacks created-at-id-v1');
  });

  it('preserves strict timestamp-only before', async () => {
    const api = fakeApi('tuple');
    const page = await storeFor(api.fetchImpl).listMessages('c-1', { limit: 20, before: new Date(api.all[140].created_at) });
    expect(page.map((m) => m.id)).toEqual(api.all.slice(120, 140).map((m) => m.id));
    expect(api.calls[0].url.searchParams.has('beforeId')).toBe(false);
  });

  it('bounds default, huge, zero, fractional and nonfinite calls', async () => {
    const api = fakeApi('tuple');
    const store = storeFor(api.fetchImpl);
    for (const limit of [undefined, 100000, 0, 2.9, NaN, Infinity]) await store.listMessages('c-1', { limit });
    expect(api.calls.map(({ url }) => url.searchParams.get('limit'))).toEqual(['100', '101', '1', '2', '100', '100']);
  });

  it('rejects an orphan/invalid cursor before fetching', async () => {
    const api = fakeApi('tuple');
    const store = storeFor(api.fetchImpl);
    await expect(store.listMessages('c-1', { beforeId: 'orphan' })).rejects.toThrow('Invalid history cursor');
    await expect(store.listMessages('c-1', { before: new Date(NaN) })).rejects.toThrow('Invalid history timestamp');
    expect(api.calls).toHaveLength(0);
  });

  it('wraps transport failures as retryable hosted history errors', async () => {
    const fetchImpl = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(storeFor(fetchImpl).listMessages('c-1')).rejects.toMatchObject({
      name: 'HostedHistoryError', code: 'HOSTED_HISTORY_UNAVAILABLE',
    });
  });

  it('only a genuine 404 is empty history; outages and malformed bodies are errors', async () => {
    const response = (status: number, text = 'nope') => (async () => new Response(text, { status, headers: { [HISTORY_PAGINATION_HEADER]: HISTORY_PAGINATION } })) as typeof fetch;
    await expect(storeFor(response(404)).listMessages('foreign')).resolves.toEqual([]);
    for (const status of [401, 403, 429, 500, 503]) await expect(storeFor(response(status)).listMessages('c-1')).rejects.toThrow('failed');
    await expect(storeFor(response(200, '<html>maintenance</html>')).listMessages('c-1')).rejects.toThrow('Invalid hosted history response');
    await expect(storeFor(response(200, JSON.stringify({ messages: [null] }))).listMessages('c-1')).rejects.toThrow('Invalid message');
  });
});

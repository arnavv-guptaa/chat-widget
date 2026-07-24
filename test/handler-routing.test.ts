import { describe, it, expect, vi } from 'vitest';
import { createChatHandler } from '../src/server/handler';
import { ConversationOwnershipError, type ChatStore } from '../src/server/chat-store';
import type { StoredConversation, StoredMessage } from '../src/server/types';

function conv(id: string): StoredConversation {
  return { id, title: 'T', metadata: null, createdAt: new Date(0), updatedAt: new Date(0) };
}

interface SetupOpts {
  /** getUserId return. `undefined` → 'realuser'; pass `null` for an unauthenticated request. */
  userId?: string | null;
  /** Make ensureConversation throw an ownership error (foreign conversation). */
  ownershipError?: boolean;
  /** Provide a storage factory (default: none → uploads 503). */
  withStorage?: boolean;
  withPublishedConfig?: boolean;
  trustPreview?: boolean;
  storageScope?: string;
}

function setup(opts: SetupOpts = {}) {
  const factoryUserIds: string[] = [];
  const store: ChatStore = {
    userId: 'bound',
    listConversations: vi.fn(async () => [conv('c1')]),
    getConversation: vi.fn(async (id: string) => conv(id)),
    ensureConversation: vi.fn(async (id: string) => {
      if (opts.ownershipError) throw new ConversationOwnershipError(id);
      return conv(id);
    }),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => true),
    listMessages: vi.fn(async () => [] as StoredMessage[]),
    saveTurn: vi.fn(async () => {}),
  };

  const handler = createChatHandler({
    getUserId: async () => (opts.userId === undefined ? 'realuser' : opts.userId),
    model: 'test/model',
    store: (userId: string) => {
      factoryUserIds.push(userId);
      return store;
    },
    ...(opts.withPublishedConfig
      ? {
          getHostedConfig: async () => ({
            agent: 'agent-public',
            revision: 'rev-7',
            config: {
              schemaVersion: 1 as const,
              runtime: { model: 'published/model', systemPrompt: 'Published' },
              client: { capabilitiesPrompt: 'Ask me anything' },
            },
          }),
        }
      : {}),
    ...(opts.trustPreview ? { resolvePreviewConfig: async (config: any) => config } : {}),
    ...(opts.storageScope ? { resolveStorageScope: async () => opts.storageScope! } : {}),
    ...(opts.withStorage
      ? {
          storage: () => ({
            userId: 'bound',
            upload: vi.fn(),
            resign: vi.fn(async () => null),
            remove: vi.fn(async () => {}),
          }),
        }
      : {}),
  });

  return { handler, store, factoryUserIds };
}

const req = (path: string, init?: RequestInit) => new Request(`https://app.example${path}`, init);
const jsonReq = (path: string, method: string, body: unknown) =>
  req(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('handler — auth gate', () => {
  it('401s an unauthenticated chat request', async () => {
    const { handler } = setup({ userId: null });
    const res = await handler.POST(jsonReq('/api/chat', 'POST', { id: 'c1', messages: [] }));
    expect(res.status).toBe(401);
  });

  it('401s an unauthenticated history request', async () => {
    const { handler } = setup({ userId: null });
    const res = await handler.GET(req('/api/chat/history'));
    expect(res.status).toBe(401);
  });
});

describe('handler — IDOR / identity boundary', () => {
  it('binds the store to the SERVER-verified user, never a spoofed X-User-Id', async () => {
    const { handler, factoryUserIds } = setup({ userId: 'realuser', ownershipError: true });
    const res = await handler.POST(
      req('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': 'attacker' },
        body: JSON.stringify({
          id: 'c1',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        }),
      }),
    );
    // The store is constructed with the verified id — the forged legacy header is ignored.
    expect(factoryUserIds).toContain('realuser');
    expect(factoryUserIds).not.toContain('attacker');
    // A conversation owned by someone else is rejected — nothing is written.
    expect(res.status).toBe(403);
  });

  it('rejects writing into another user’s conversation with 403', async () => {
    const { handler, store } = setup({ ownershipError: true });
    const res = await handler.POST(
      jsonReq('/api/chat', 'POST', { id: 'foreign', messages: [{ role: 'user', parts: [{ type: 'text', text: 'x' }] }] }),
    );
    expect(store.ensureConversation).toHaveBeenCalledWith('foreign');
    expect(res.status).toBe(403);
    expect(store.saveTurn).not.toHaveBeenCalled();
  });
});

describe('handler — dispatch routing', () => {
  it('400s a chat turn with no conversation id', async () => {
    const { handler } = setup();
    const res = await handler.POST(jsonReq('/api/chat', 'POST', { messages: [] }));
    expect(res.status).toBe(400);
  });

  it('405s a GET on the chat root (POST-only)', async () => {
    const { handler } = setup();
    expect((await handler.GET(req('/api/chat'))).status).toBe(405);
  });

  it('routes authenticated GET /bootstrap and returns only the client projection plus an opaque scope', async () => {
    const { handler } = setup({ withPublishedConfig: true });
    const res = await handler.GET(req('/api/chat/bootstrap'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      protocolVersion: 1,
      agent: 'agent-public',
      revision: 'rev-7',
      client: { capabilitiesPrompt: 'Ask me anything' },
    });
    expect(body.storageScope).toMatch(/^[a-f0-9]{36}$/);
    expect(JSON.stringify(body)).not.toContain('Published');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('401s an unauthenticated bootstrap request', async () => {
    const { handler } = setup({ userId: null });
    expect((await handler.GET(req('/api/chat/bootstrap'))).status).toBe(401);
  });

  it('uses an explicitly provided stable storage-scope resolver', async () => {
    const { handler } = setup({ storageScope: 'tenant-keyed-scope' });
    const res = await handler.GET(req('/api/chat/bootstrap'));
    expect(res.status).toBe(200);
    expect((await res.json()).storageScope).toBe('tenant-keyed-scope');
  });

  it('ignores even malformed request config when no preview resolver is installed', async () => {
    const { handler } = setup({ ownershipError: true });
    const res = await handler.POST(
      jsonReq('/api/chat', 'POST', { id: 'c1', messages: [], config: { model: 'forged/request-model' } }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects malformed request config only when an explicit preview resolver is installed', async () => {
    const { handler } = setup({ trustPreview: true });
    const res = await handler.POST(jsonReq('/api/chat', 'POST', { id: 'c1', messages: [], config: { model: 'legacy' } }));
    expect(res.status).toBe(400);
  });

  it('routes GET /history to the conversation list', async () => {
    const { handler, store } = setup();
    const res = await handler.GET(req('/api/chat/history'));
    expect(res.status).toBe(200);
    expect(store.listConversations).toHaveBeenCalled();
    expect((await res.json()).conversations).toHaveLength(1);
  });

  it('routes DELETE /history/:id and returns 204', async () => {
    const { handler, store } = setup();
    const res = await handler.DELETE(req('/api/chat/history/c1', { method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(store.deleteConversation).toHaveBeenCalledWith('c1');
  });

  it('is mount-agnostic: resolves /history under an arbitrary prefix', async () => {
    const { handler, store } = setup();
    const res = await handler.GET(req('/api/preview-chat/agent-42/history'));
    expect(res.status).toBe(200);
    expect(store.listConversations).toHaveBeenCalled();
  });

  it('503s upload when no storage is configured', async () => {
    const { handler } = setup(); // no storage
    const res = await handler.POST(req('/api/chat/upload', { method: 'POST' }));
    expect(res.status).toBe(503);
  });

  it('503s memory routes when memory is not configured', async () => {
    const { handler } = setup();
    expect((await handler.GET(req('/api/chat/memory'))).status).toBe(503);
  });
});

describe('handler — feedback route', () => {
  it('no-ops (200) with no onFeedback seam', async () => {
    const { handler } = setup();
    const res = await handler.POST(jsonReq('/api/chat/feedback', 'POST', { messageId: 'm1', rating: 'up' }));
    expect(res.status).toBe(200);
  });

  it('400s an invalid rating', async () => {
    const { handler } = setup();
    const res = await handler.POST(jsonReq('/api/chat/feedback', 'POST', { messageId: 'm1', rating: 'sideways' }));
    expect(res.status).toBe(400);
  });
});

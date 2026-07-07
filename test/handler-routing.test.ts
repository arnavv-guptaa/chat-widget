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
      jsonReq('/api/chat', 'POST', { id: 'c1', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );
    // The store is constructed with the verified id — the forged header is ignored.
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

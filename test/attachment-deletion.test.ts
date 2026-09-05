import { afterEach, describe, it, expect, vi } from 'vitest';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import type { StorageAdapter } from '../src/server/storage-adapter';
import type { StoredConversation, StoredMessage } from '../src/server/types';

const paths = ['realuser/c1/first/a.png', 'realuser/c1/second/b.png'];

function setup(options: { userId?: string | null; withStorage?: boolean } = {}) {
  let conversation: StoredConversation | null = {
    id: 'c1', title: 'T', metadata: null, createdAt: new Date(0), updatedAt: new Date(0),
  };
  let messages: StoredMessage[] = [{
    id: 'm1', role: 'user', text: '', createdAt: new Date(0),
    parts: paths.map((storagePath) => ({
      type: 'file' as const, storagePath, url: 'https://storage.example/signed', mediaType: 'image/png',
    })),
  }];
  const store: ChatStore = {
    userId: 'realuser',
    listConversations: vi.fn(async () => conversation ? [conversation] : []),
    getConversation: vi.fn(async (id) => id === conversation?.id ? conversation : null),
    ensureConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(async () => {
      if (!conversation) return false;
      conversation = null;
      messages = [];
      return true;
    }),
    listMessages: vi.fn(async () => messages),
    saveTurn: vi.fn(),
  };
  const storage: StorageAdapter = {
    userId: 'realuser', upload: vi.fn(), resign: vi.fn(), remove: vi.fn(async () => {}),
  };
  const storeFactory = vi.fn(() => store);
  const storageFactory = vi.fn(() => storage);
  const handler = createChatHandler({
    getUserId: async () => options.userId === undefined ? 'realuser' : options.userId,
    model: 'test/model',
    store: storeFactory,
    ...(options.withStorage === false ? {} : { storage: storageFactory }),
  });
  const removeConversation = (id = 'c1') => handler.DELETE(new Request(
    `https://app.example/api/chat/history/${id}`,
    { method: 'DELETE', headers: { 'x-user-id': 'attacker' } },
  ));
  return { store, storage, storeFactory, storageFactory, removeConversation };
}

afterEach(() => vi.restoreAllMocks());

describe('handler — attachment deletion', () => {
  it('retains conversation and paths on partial purge failure, then succeeds on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, storage, removeConversation } = setup();
    const blobs = new Set(paths);
    let fail = true;
    vi.mocked(storage.remove).mockImplementation(async (path) => {
      if (path === paths[1] && fail) throw new Error('Storage unavailable');
      blobs.delete(path); // Missing blobs are a successful no-op on retry.
    });

    const failed = await removeConversation();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Internal server error' });
    expect(store.deleteConversation).not.toHaveBeenCalled();
    expect(blobs).toEqual(new Set([paths[1]]));
    expect(await store.getConversation('c1')).not.toBeNull();
    expect((await store.listMessages('c1'))[0].parts).toEqual(
      expect.arrayContaining(paths.map((storagePath) => expect.objectContaining({ storagePath }))),
    );

    fail = false;
    expect((await removeConversation()).status).toBe(204);
    expect(storage.remove).toHaveBeenCalledTimes(4);
    expect(store.deleteConversation).toHaveBeenCalledExactlyOnceWith('c1');
    expect(blobs.size).toBe(0);
    expect(await store.getConversation('c1')).toBeNull();
    expect(await store.listMessages('c1')).toEqual([]);
    expect((await removeConversation()).status).toBe(404);
    expect(storage.remove).toHaveBeenCalledTimes(4);
  });

  it('waits for in-flight removals before returning a purge error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, storage, removeConversation } = setup();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(storage.remove)
      .mockRejectedValueOnce(new Error('First removal failed'))
      .mockImplementationOnce(() => pending);
    let settled = false;
    const response = removeConversation().then((result) => { settled = true; return result; });
    await vi.waitFor(() => expect(storage.remove).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(store.deleteConversation).not.toHaveBeenCalled();
    finish();
    expect((await response).status).toBe(500);
    expect(store.deleteConversation).not.toHaveBeenCalled();
  });

  it('retains rows when collecting attachment paths fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, storage, removeConversation } = setup();
    vi.mocked(store.listMessages).mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await removeConversation()).status).toBe(500);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(store.deleteConversation).not.toHaveBeenCalled();
    expect(await store.getConversation('c1')).not.toBeNull();
  });

  it.each(['missing', 'foreign'])('404s a %s conversation without touching messages or blobs', async (id) => {
    const { store, storage, storeFactory, storageFactory, removeConversation } = setup();
    expect((await removeConversation(id)).status).toBe(404);
    expect(storeFactory).toHaveBeenCalledWith('realuser');
    expect(storageFactory).toHaveBeenCalledWith('realuser');
    expect(store.getConversation).toHaveBeenCalledWith(id);
    expect(store.listMessages).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(store.deleteConversation).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated delete without resolving storage or the store', async () => {
    const { storeFactory, storageFactory, removeConversation } = setup({ userId: null });
    expect((await removeConversation()).status).toBe(401);
    expect(storeFactory).not.toHaveBeenCalled();
    expect(storageFactory).not.toHaveBeenCalled();
  });

  it('still deletes conversations with no attachments', async () => {
    const { store, storage, removeConversation } = setup();
    vi.mocked(store.listMessages).mockResolvedValue([]);
    expect((await removeConversation()).status).toBe(204);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(store.deleteConversation).toHaveBeenCalledWith('c1');
  });

  it('preserves DB-only deletion when no storage adapter is configured', async () => {
    const { store, removeConversation } = setup({ withStorage: false });
    expect((await removeConversation()).status).toBe(204);
    expect(store.listMessages).not.toHaveBeenCalled();
    expect(store.deleteConversation).toHaveBeenCalledWith('c1');
  });

  it('can retry a DB deletion failure after the blobs have been purged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, storage, removeConversation } = setup();
    vi.mocked(store.deleteConversation).mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await removeConversation()).status).toBe(500);
    expect(await store.getConversation('c1')).not.toBeNull();
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect((await removeConversation()).status).toBe(204);
    expect(storage.remove).toHaveBeenCalledTimes(4);
    expect(await store.getConversation('c1')).toBeNull();
  });

  it('preserves 404 if the row disappears before the final delete', async () => {
    const { store, removeConversation } = setup();
    vi.mocked(store.deleteConversation).mockResolvedValue(false);
    expect((await removeConversation()).status).toBe(404);
  });
});

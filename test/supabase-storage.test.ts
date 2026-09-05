import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createSupabaseStorage } from '../src/server/stores/supabase/storage';

const { remove, from } = vi.hoisted(() => {
  const remove = vi.fn();
  return { remove, from: vi.fn(() => ({ remove })) };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from } })),
}));

function storageFor(userId = 'user-1') {
  return createSupabaseStorage({
    supabaseUrl: 'https://storage.example', serviceRoleKey: 'test-only', bucket: 'private-attachments',
  })(userId);
}

beforeEach(() => {
  vi.clearAllMocks();
  remove.mockReset();
  remove.mockResolvedValue({ data: [], error: null });
});

describe('Supabase storage — remove', () => {
  it('throws when Supabase returns an error instead of rejecting', async () => {
    remove.mockResolvedValueOnce({ data: null, error: { message: 'Storage unavailable' } });
    await expect(storageFor().remove('user-1/c1/token/file.png')).rejects.toThrow(
      '[chat-widget] storage remove failed: Storage unavailable',
    );
    expect(from).toHaveBeenCalledWith('private-attachments');
    expect(remove).toHaveBeenCalledWith(['user-1/c1/token/file.png']);
  });

  it('propagates transport rejections', async () => {
    const error = new Error('Connection lost');
    remove.mockRejectedValueOnce(error);
    await expect(storageFor().remove('user-1/c1/token/file.png')).rejects.toBe(error);
  });

  it('allows retry after a returned error and treats already-missing objects as success', async () => {
    const storage = storageFor();
    const path = 'user-1/c1/token/file.png';
    remove.mockResolvedValueOnce({ data: null, error: { message: 'Temporary failure' } });
    await expect(storage.remove(path)).rejects.toThrow('Temporary failure');
    // Supabase remove succeeds with an empty result for an absent object.
    await expect(storage.remove(path)).resolves.toBeUndefined();
    await expect(storage.remove(path)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it.each([
    'user-2/c1/token/file.png',
    'user-10/c1/token/file.png',
    'user-1/../user-2/file.png',
  ])('never sends a foreign or unsafe path to Supabase: %s', async (path) => {
    await expect(storageFor().remove(path)).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

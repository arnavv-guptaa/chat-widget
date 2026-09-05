// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  HOSTED_BASE_URL,
  VISITOR_HEADER,
  getOrCreateVisitorId,
  hostedApiBase,
  newVisitorId,
  useHostedAuth,
} from '../src/hooks/use-hosted-auth';

/**
 * Hosted runtime mode — client half. The widget's transport already supports a
 * cross-origin apiBase + headers; these tests pin the pieces this mode adds:
 * the apiBase derivation, the visitor id contract chat-api validates, and the
 * hook that turns `getUserToken` into headers (token wins over visitor; ready
 * gates bootstrap; a throwing getter degrades to no token, never to a crash).
 */

describe('hostedApiBase', () => {
  it('derives /v1/hosted/<key> from the default or an overridden base', () => {
    expect(hostedApiBase('pk_live_abc')).toBe(`${HOSTED_BASE_URL}/v1/hosted/pk_live_abc`);
    expect(hostedApiBase(' pk_live_abc ', 'https://api.example.com/')).toBe('https://api.example.com/v1/hosted/pk_live_abc');
  });
});

describe('visitor id', () => {
  beforeEach(() => window.localStorage.clear());

  it('is url-safe and within the 16–64 chars chat-api accepts', () => {
    const id = newVisitorId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('persists across calls and repairs a corrupt stored value', () => {
    const first = getOrCreateVisitorId();
    expect(getOrCreateVisitorId()).toBe(first);
    window.localStorage.setItem('mordn:visitor', 'bad value!');
    const repaired = getOrCreateVisitorId();
    expect(repaired).not.toBe('bad value!');
    expect(repaired).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const REFRESH_MS = 4 * 60 * 1000;

describe('useHostedAuth', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is inert (empty headers, ready) when hosted mode is off', () => {
    const { result } = renderHook(() => useHostedAuth({ enabled: false, getUserToken: () => 'tok' }));
    expect(result.current.headers).toEqual({});
    expect(result.current.ready).toBe(true);
  });

  it('waits for getUserToken, then sends Authorization and NOT the visitor header', async () => {
    let resolveToken: (t: string) => void = () => {};
    const getUserToken = vi.fn(() => new Promise<string>((r) => (resolveToken = r)));
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken, anonymous: true }));
    expect(result.current.ready).toBe(false);
    await act(async () => resolveToken('eyJ.token'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.headers).toEqual({ Authorization: 'Bearer eyJ.token' });
    expect(result.current.headers[VISITOR_HEADER]).toBeUndefined();
  });

  it('falls back to the visitor header only when anonymous is enabled and no token exists', async () => {
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken: () => null, anonymous: true }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const visitor = result.current.headers[VISITOR_HEADER];
    expect(visitor).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(window.localStorage.getItem('mordn:visitor')).toBe(visitor);

    const strict = renderHook(() => useHostedAuth({ enabled: true, getUserToken: () => null, anonymous: false }));
    await waitFor(() => expect(strict.result.current.ready).toBe(true));
    expect(strict.result.current.headers).toEqual({});
  });

  it('a throwing getUserToken degrades to no token and still becomes ready', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useHostedAuth({
        enabled: true,
        getUserToken: () => {
          throw new Error('boom');
        },
      }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.headers).toEqual({});
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('masks the old session in the transition render, even with a stable getter', async () => {
    let token: string | Promise<string> = 'alice';
    const getUserToken = vi.fn(() => token);
    const seen: Array<{ key: number; ready: boolean; headers: Record<string, string> }> = [];
    const { result, rerender } = renderHook(({ key }) => {
      const auth = useHostedAuth({ enabled: true, getUserToken, anonymous: true, sessionKey: key });
      seen.push({ key, ready: auth.ready, headers: auth.headers });
      return auth;
    }, { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer alice'));
    const next = deferred<string>();
    token = next.promise;
    rerender({ key: 1 });
    expect(seen.find((state) => state.key === 1)).toEqual({ key: 1, ready: false, headers: {} });
    expect(result.current.ready).toBe(false);
    expect(result.current.headers).toEqual({}); // not even a visitor while pending
    await act(async () => next.resolve('bob'));
    expect(result.current.headers).toEqual({ Authorization: 'Bearer bob' });
    expect(getUserToken).toHaveBeenCalledTimes(2);
  });

  it('reset isolates logout from an older pending resolution', async () => {
    const old = deferred<string>();
    let token: string | null | Promise<string> = 'alice';
    const getUserToken = () => token;
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken, anonymous: true }));
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer alice'));
    token = old.promise;
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    token = null;
    const session = result.current.session;
    await act(async () => result.current.reset());
    expect(result.current.session).not.toBe(session);
    const visitorHeaders = result.current.headers;
    expect(visitorHeaders[VISITOR_HEADER]).toBeTruthy();
    await act(async () => old.resolve('stale-alice'));
    expect(result.current.headers).toEqual(visitorHeaders);
    expect(result.current.ready).toBe(true);
  });

  it('stays unready while reset is pending and ignores an earlier rejection', async () => {
    const stale = deferred<string>();
    const next = deferred<string>();
    const getUserToken = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(next.promise);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    act(() => result.current.reset());
    await act(async () => stale.reject(new Error('stale error')));
    expect(result.current.ready).toBe(false);
    expect(result.current.headers).toEqual({});
    expect(error).not.toHaveBeenCalled();
    await act(async () => next.resolve('new'));
    expect(result.current.headers.Authorization).toBe('Bearer new');
  });

  it('clears disabling/removal and resolves again on enabling/adding a getter', async () => {
    const stale = deferred<string>();
    const next = deferred<string>();
    const getUserToken = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ enabled, getter }: { enabled: boolean; getter?: typeof getUserToken }) =>
        useHostedAuth({ enabled, getUserToken: getter }),
      { initialProps: { enabled: true, getter: getUserToken } },
    );
    rerender({ enabled: false, getter: getUserToken });
    expect(result.current.headers).toEqual({});
    expect(result.current.ready).toBe(true);
    await act(async () => stale.resolve('old'));
    rerender({ enabled: true, getter: getUserToken });
    expect(result.current.ready).toBe(false);
    expect(result.current.headers).toEqual({});
    await act(async () => next.resolve('current'));
    expect(result.current.headers.Authorization).toBe('Bearer current');
    rerender({ enabled: true, getter: undefined });
    expect(result.current.headers).toEqual({});
    expect(result.current.ready).toBe(true);
    getUserToken.mockReturnValue('added');
    rerender({ enabled: true, getter: getUserToken });
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer added'));
    expect(getUserToken).toHaveBeenCalledTimes(3);
  });

  it('does not re-resolve inline callbacks on render, but refresh uses the latest getter', async () => {
    const called = vi.fn();
    const { result, rerender } = renderHook(({ token }) => useHostedAuth({
      enabled: true,
      getUserToken: () => { called(token); return token; },
    }), { initialProps: { token: 'first' } });
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer first'));
    const session = result.current.session;
    rerender({ token: 'latest' });
    expect(called).toHaveBeenCalledTimes(1);
    expect(result.current.headers.Authorization).toBe('Bearer first');
    await act(async () => result.current.refresh());
    expect(called).toHaveBeenCalledTimes(2);
    expect(called).toHaveBeenLastCalledWith('latest');
    expect(result.current.headers.Authorization).toBe('Bearer latest');
    expect(result.current.session).toBe(session);
  });

  it('only the latest overlapping interval resolution may commit', async () => {
    const older = deferred<string>();
    const newer = deferred<string | null>();
    const getUserToken = vi.fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer first'));
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS * 2); });
    await act(async () => newer.resolve(null));
    expect(result.current.headers).toEqual({});
    await act(async () => older.resolve('obsolete'));
    expect(result.current.headers).toEqual({});
  });

  it('ignores an older interval rejection after a newer success', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getUserToken = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await act(async () => newer.resolve('latest'));
    await act(async () => older.reject(new Error('obsolete')));
    expect(result.current.headers.Authorization).toBe('Bearer latest');
    expect(error).not.toHaveBeenCalled();
  });

  it('refresh invalidates pending work and retains same-session auth until it settles', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const getUserToken = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    await waitFor(() => expect(result.current.headers.Authorization).toBe('Bearer first'));
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    act(() => result.current.refresh());
    await act(async () => older.resolve('obsolete'));
    expect(result.current.headers.Authorization).toBe('Bearer first');
    expect(result.current.ready).toBe(true);
    await act(async () => newer.resolve('refreshed'));
    expect(result.current.headers.Authorization).toBe('Bearer refreshed');
  });

  it('cancels pending work and removes the interval on unmount', async () => {
    const pending = deferred<string>();
    const getUserToken = vi.fn(() => pending.promise);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    unmount();
    await act(async () => pending.reject(new Error('after unmount')));
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS * 2); });
    expect(getUserToken).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('re-resolves the token on the refresh interval', async () => {
    let n = 0;
    const getUserToken = vi.fn(async () => `tok-${++n}`);
    const { result } = renderHook(() => useHostedAuth({ enabled: true, getUserToken }));
    await waitFor(() => expect(result.current.headers).toEqual({ Authorization: 'Bearer tok-1' }));
    await act(async () => {
      vi.advanceTimersByTime(4 * 60 * 1000 + 10);
    });
    await waitFor(() => expect(result.current.headers).toEqual({ Authorization: 'Bearer tok-2' }));
    expect(getUserToken).toHaveBeenCalledTimes(2);
  });
});

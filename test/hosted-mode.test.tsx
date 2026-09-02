// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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

describe('useHostedAuth', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

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

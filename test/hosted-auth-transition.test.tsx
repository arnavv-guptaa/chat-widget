// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWidget, type ChatWidgetHandle } from '../src/ChatWidget';
import { useChatStorageKey } from '../src/contexts/chat-storage-context';

// Keep the actual auth/bootstrap/storage wiring, but isolate the conversation
// surface so we can observe teardown (including its private in-memory draft).
vi.mock('../src/components/interface', () => ({
  default: function ChatProbe() {
    const { storageKeyPrefix } = useChatStorageKey();
    const [draft, setDraft] = useState('');
    return <div data-testid="chat" data-scope={storageKeyPrefix}>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function bootstrap(scope: string) {
  return {
    protocolVersion: 1,
    agent: 'agent-1',
    revision: 'rev-1',
    client: { display: { layout: 'inline' } },
    storageScope: scope,
  };
}

function response(scope: string): Response {
  return { ok: true, json: async () => bootstrap(scope) } as Response;
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatWidget hosted auth transitions', () => {
  it('unmounts the previous chat immediately and waits for the new session bootstrap', async () => {
    const token = deferred<string>();
    const nextBootstrap = deferred<Response>();
    let currentToken: string | Promise<string> = 'alice';
    const getUserToken = vi.fn(() => currentToken);
    fetchMock.mockResolvedValueOnce(response('server-alice')).mockReturnValueOnce(nextBootstrap.promise);
    const { rerender } = render(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} authSessionKey={0} anonymous />);
    await screen.findByTestId('chat');
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'private alice draft' } });
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('server-alice');

    currentToken = token.promise;
    rerender(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} authSessionKey={1} anonymous />);
    expect(screen.queryByTestId('chat')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => token.resolve('bob'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('chat')).toBeNull();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bearer bob' }, credentials: 'omit',
    });
    // Only signed tokens and server-issued opaque scopes carry identity. The
    // lifecycle marker is not added to the URL, headers, body or storage keys.
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.mordn.com/v1/hosted/pk_live_test/bootstrap');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer bob' });
    await act(async () => nextBootstrap.resolve(response('server-bob')));
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('server-bob');
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
  });

  it('resetAuth re-bootstraps and drops mounted state even when the token is unchanged', async () => {
    const ref = createRef<ChatWidgetHandle>();
    const nextBootstrap = deferred<Response>();
    const getUserToken = vi.fn(() => 'same-token');
    fetchMock.mockResolvedValueOnce(response('scope')).mockReturnValueOnce(nextBootstrap.promise);
    render(<ChatWidget ref={ref} publishableKey="pk_live_test" getUserToken={getUserToken} />);
    await screen.findByTestId('chat');
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'private draft' } });
    act(() => ref.current!.resetAuth());
    expect(screen.queryByTestId('chat')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(getUserToken).toHaveBeenCalledTimes(2);
    await act(async () => nextBootstrap.resolve(response('scope')));
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
  });

  it('resetAuth invalidates bootstrap even without a getter or changed visitor headers', async () => {
    const ref = createRef<ChatWidgetHandle>();
    const nextBootstrap = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response('visitor')).mockReturnValueOnce(nextBootstrap.promise);
    render(<ChatWidget ref={ref} publishableKey="pk_live_test" anonymous />);
    await screen.findByTestId('chat');
    act(() => ref.current!.resetAuth());
    expect(screen.queryByTestId('chat')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual(fetchMock.mock.calls[0][1]?.headers);
    await act(async () => nextBootstrap.resolve(response('visitor')));
    expect(screen.getByTestId('chat')).toBeTruthy();
  });

  it.each(['success', 'error'] as const)('ignores a stale bootstrap body %s after a newer session succeeds', async (outcome) => {
    const oldBody = deferred<ReturnType<typeof bootstrap>>();
    const json = vi.fn(() => oldBody.promise);
    fetchMock.mockResolvedValueOnce({ ok: true, json } as unknown as Response)
      .mockResolvedValueOnce(response('new-scope'));
    const getUserToken = () => 'same-token';
    const { rerender } = render(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} authSessionKey={0} />);
    await waitFor(() => expect(json).toHaveBeenCalledOnce());
    rerender(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} authSessionKey={1} />);
    await screen.findByTestId('chat');
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('new-scope');
    await act(async () => {
      if (outcome === 'success') oldBody.resolve(bootstrap('old-scope'));
      else oldBody.reject(new Error('old request failed'));
    });
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('new-scope');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('logout clears the chat and sends only the visitor header when opted in', async () => {
    const getUserToken = vi.fn<() => string | null>().mockReturnValue('alice');
    const loggedOut = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response('alice-scope')).mockReturnValueOnce(loggedOut.promise);
    const { rerender } = render(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} anonymous authSessionKey={0} />);
    await screen.findByTestId('chat');
    getUserToken.mockReturnValue(null);
    rerender(<ChatWidget publishableKey="pk_live_test" getUserToken={getUserToken} anonymous authSessionKey={1} />);
    expect(screen.queryByTestId('chat')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Mordn-Visitor']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    await act(async () => loggedOut.resolve(response('visitor-scope')));
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('visitor-scope');
  });

  it('switching out of hosted mode drops the old scope and uses server session credentials', async () => {
    const ref = createRef<ChatWidgetHandle>();
    const serverBootstrap = deferred<Response>();
    const getUserToken = vi.fn(() => 'alice');
    fetchMock.mockResolvedValueOnce(response('hosted-scope')).mockReturnValueOnce(serverBootstrap.promise);
    const { rerender } = render(<ChatWidget ref={ref} publishableKey="pk_live_test" getUserToken={getUserToken} />);
    await screen.findByTestId('chat');
    rerender(<ChatWidget ref={ref} apiBase="/api/chat" getUserToken={getUserToken} requestCredentials="same-origin" />);
    expect(screen.queryByTestId('chat')).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/chat/bootstrap');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', headers: undefined });
    await act(async () => serverBootstrap.resolve(response('server-scope')));
    expect(screen.getByTestId('chat').getAttribute('data-scope')).toBe('server-scope');
    act(() => ref.current!.resetAuth()); // hosted-only: server auth is not client-controlled
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getUserToken).toHaveBeenCalledOnce();
  });

  it('a destination change re-resolves auth rather than forwarding an old token', async () => {
    const token = deferred<string>();
    const getUserToken = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce(token.promise);
    fetchMock.mockResolvedValueOnce(response('first-scope')).mockResolvedValueOnce(response('second-scope'));
    const { rerender } = render(<ChatWidget publishableKey="pk_live_first" getUserToken={getUserToken} />);
    await screen.findByTestId('chat');
    rerender(<ChatWidget publishableKey="pk_live_second" hostedBaseUrl="https://chat.example.com" getUserToken={getUserToken} />);
    expect(screen.queryByTestId('chat')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => token.resolve('second'));
    await screen.findByTestId('chat');
    expect(fetchMock.mock.calls[1][0]).toBe('https://chat.example.com/v1/hosted/pk_live_second/bootstrap');
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer second' });
  });
});

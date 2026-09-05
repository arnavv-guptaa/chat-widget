/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatErrorBanner } from '../src/components/chat-error-banner';
import { createChatErrorRecovery } from '../src/utils/chat-error-recovery';
import { messageForErrorKind, type ChatErrorKind } from '../src/utils/chat-error-protocol';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ChatErrorBanner taxonomy messages', () => {
  it.each([
    'The assistant is handling a lot of requests right now. Please try again in a moment.',
    'The assistant is not configured correctly. Please contact support.',
    'The assistant is temporarily unavailable. Please try again.',
    "I can't help with that request.",
    "That request couldn't be processed. Try rephrasing or shortening your message.",
    'The configured model could not complete this request. Try a different request or contact support.',
    'A tool the assistant was using failed. Please try again.',
    'An error occurred while generating the response.',
  ])('preserves package-owned safe guidance: %s', (message) => {
    render(<ChatErrorBanner error={new Error(message)} />);
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.getByRole('alert').hasAttribute('title')).toBe(false);
  });

  it.each([
    'The assistant is not configured correctly. Please contact support.',
    "I can't help with that request.",
    "That request couldn't be processed. Try rephrasing or shortening your message.",
    'The configured model could not complete this request. Try a different request or contact support.',
  ])('does not offer a blind retry for %s', (message) => {
    const onRetry = vi.fn();
    render(
      <ChatErrorBanner
        error={new Error(message)}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps retry available for transient package errors', () => {
    const onRetry = vi.fn();
    render(
      <ChatErrorBanner
        error={new Error('The assistant is temporarily unavailable. Please try again.')}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each([
    {
      variant: 'provider URL and query secret',
      raw: 'Provider failed: https://api.provider.example/v1/chat?api_key=sk-test-banner-secret',
      safe: 'Something went wrong while generating the response.',
    },
    {
      variant: 'network error with authorization header',
      raw: 'Failed to fetch https://api.provider.example/v1/chat Authorization: Bearer sk-test-banner-secret',
      safe: 'Connection issue. Check your network and try again.',
    },
    {
      variant: 'rate limit with provider detail',
      raw: '429 rate_limit at api.provider.example token=sk-test-banner-secret',
      safe: "You're sending messages too fast. Wait a moment and try again.",
    },
    {
      variant: 'timeout with provider detail',
      raw: 'timeout at api.provider.example token=sk-test-banner-secret',
      safe: 'The response took too long.',
    },
    {
      variant: 'safe guidance with appended control characters and secret',
      raw: 'The assistant is temporarily unavailable. Please try again.\r\n\t\u0000\u001b[31m sk-test-banner-secret',
      safe: 'Something went wrong while generating the response.',
    },
    {
      variant: 'safe guidance with a hidden suffix',
      raw: 'The assistant is temporarily unavailable. Please try again.\u200b',
      safe: 'Something went wrong while generating the response.',
    },
    {
      variant: 'HTML-like provider payload',
      raw: '<img src="https://api.provider.example/sk-test-banner-secret" onerror="alert(1)">',
      safe: 'Something went wrong while generating the response.',
    },
  ])('keeps raw $variant out of text and DOM attributes', ({ raw, safe }) => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const error = new Error(raw);
    const { container } = render(
      <ChatErrorBanner error={error} onRetry={onRetry} onDismiss={onDismiss} />,
    );

    expect(screen.getByRole('alert').textContent).toBe(`${safe}Try again`);
    expect(container.innerHTML).not.toContain(raw);
    expect(container.innerHTML).not.toContain('api.provider.example');
    expect(container.innerHTML).not.toContain('sk-test-banner-secret');
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(error.message).toBe(raw);
  });

  it.each([
    null,
    undefined,
    Object.assign(new Error('Stopped with token=sk-test-banner-secret'), { name: 'AbortError' }),
    new Error('The response was aborted.'),
  ])('renders nothing for absent or user-stop control errors: %s', (error) => {
    const { container } = render(<ChatErrorBanner error={error} onRetry={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('respects canRetry and the presence of a retry handler', () => {
    const error = new Error('Unknown provider failure');
    const { rerender } = render(<ChatErrorBanner error={error} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    rerender(<ChatErrorBanner error={error} canRetry={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('does not hide upstream failures that merely contain the word aborted', () => {
    render(<ChatErrorBanner error={new Error('request was aborted by the upstream gateway')} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

function typedError(kind: ChatErrorKind, retryable = false, retryAfterMs?: number) {
  const seam = createChatErrorRecovery();
  const error = new Error('Translated/custom copy with sk-test-banner-secret');
  seam.onData({ type: 'data-chat-error', transient: true, data: {
    version: 1, kind, retryable, retryAfterMs,
    traceId: 'opaque-reference-1234', message: 'secret extra field',
  } });
  seam.onError(error);
  return error;
}

describe('ChatErrorBanner typed recovery', () => {
  it.each<ChatErrorKind>(['auth', 'content_policy', 'prompt', 'model', 'tool', 'unknown'])('uses %s independently of human wording and disallows blind retry', (kind) => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(<ChatErrorBanner error={typedError(kind, true)} onRetry={onRetry} onDismiss={onDismiss} />);
    expect(screen.getByRole('alert').textContent).toBe(messageForErrorKind(kind));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(container.innerHTML).not.toMatch(/secret|opaque-reference/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('suppresses typed aborts even when legacy copy does not say abort', () => {
    const { container } = render(<ChatErrorBanner error={typedError('abort')} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not let abort-like text hide a typed transient failure', () => {
    const error = typedError('transient', true);
    error.message = 'The response was aborted.';
    render(<ChatErrorBanner error={error} />);
    expect(screen.getByRole('alert').textContent).toBe(messageForErrorKind('transient'));
  });

  it('honors a retry delay across rerenders and only retries on an explicit click', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const error = typedError('rate_limit', true, 2000);
    const onRetry = vi.fn();
    const { rerender } = render(<ChatErrorBanner error={error} onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    rerender(<ChatErrorBanner error={error} onRetry={onRetry} />);
    expect(button.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(button.disabled).toBe(false);
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('never lets metadata override canRetry or retryable:false', () => {
    const { rerender } = render(<ChatErrorBanner error={typedError('transient', true)} canRetry={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    rerender(<ChatErrorBanner error={typedError('transient', false)} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('falls back safely for unknown versions rather than rendering metadata text', () => {
    const seam = createChatErrorRecovery();
    const error = new Error('unknown secret');
    seam.onData({ type: 'data-chat-error', transient: true, data: { version: 999, kind: 'auth', retryable: false, message: 'secret' } });
    seam.onError(error);
    const { container } = render(<ChatErrorBanner error={error} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(container.innerHTML).not.toContain('secret');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

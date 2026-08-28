/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatErrorBanner } from '../src/components/chat-error-banner';

describe('ChatErrorBanner taxonomy messages', () => {
  it('preserves package-owned safe guidance', () => {
    render(
      <ChatErrorBanner
        error={new Error('The assistant is temporarily unavailable. Please try again.')}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'The assistant is temporarily unavailable. Please try again.',
    );
  });

  it('does not offer a blind retry for non-retryable categories', () => {
    const onRetry = vi.fn();
    render(
      <ChatErrorBanner
        error={new Error('The assistant is not configured correctly. Please contact support.')}
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

  it('does not hide upstream failures that merely contain the word aborted', () => {
    render(<ChatErrorBanner error={new Error('request was aborted by the upstream gateway')} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

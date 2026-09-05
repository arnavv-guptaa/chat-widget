/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOpenTriggers } from '../src/hooks/use-open-triggers';

const actions = () => ({ open: vi.fn(), close: vi.fn(), toggle: vi.fn() });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useOpenTriggers', () => {
  it.each([
    ['MacIntel', { metaKey: true }],
    ['Linux x86_64', { ctrlKey: true }],
  ] as const)('classifies mod+i on %s as user intent with exact modifiers', (platform, modifier) => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
    const callbacks = actions();
    renderHook(() => useOpenTriggers('mod+i', callbacks));

    expect(fireEvent.keyDown(document.body, { key: 'I', ...modifier })).toBe(false);
    expect(callbacks.toggle).toHaveBeenCalledExactlyOnceWith('user');
    expect(fireEvent.keyDown(document.body, { key: 'i', ...modifier, shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'i' })).toBe(true);
    expect(callbacks.toggle).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, '', 'mod+'] as const)('does not claim keys with shortcut %s', (shortcut) => {
    const callbacks = actions();
    renderHook(() => useOpenTriggers(shortcut, callbacks));
    expect(fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true })).toBe(true);
    expect(callbacks.toggle).not.toHaveBeenCalled();
  });

  it.each(['/', 'ctrl+i'])('leaves %s alone in form controls and inherited editable surfaces', (shortcut) => {
    const callbacks = actions();
    renderHook(() => useOpenTriggers(shortcut, callbacks));
    render(
      <>
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <select data-testid="select"><option>Option</option></select>
        <div contentEditable suppressContentEditableWarning data-testid="editable">
          <span data-testid="nested">Editor text</span>
        </div>
        <div contentEditable="plaintext-only" suppressContentEditableWarning>
          <span data-testid="plaintext">Plain text</span>
        </div>
        <div ref={(element) => { element?.setAttribute('contenteditable', ''); }} data-testid="empty-editable" />
      </>,
    );
    for (const id of ['input', 'textarea', 'select', 'editable', 'nested', 'plaintext', 'empty-editable']) {
      const target = screen.getByTestId(id);
      target.focus();
      expect(fireEvent.keyDown(target, { key: shortcut === '/' ? '/' : 'i', ctrlKey: shortcut !== '/' })).toBe(true);
    }
    expect(callbacks.toggle).not.toHaveBeenCalled();
  });

  it('respects contenteditable=false islands', () => {
    const callbacks = actions();
    renderHook(() => useOpenTriggers('ctrl+i', callbacks));
    render(
      <div contentEditable suppressContentEditableWarning>
        <button contentEditable={false}>Noneditable action</button>
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'i', ctrlKey: true });
    expect(callbacks.toggle).toHaveBeenCalledExactlyOnceWith('user');
  });

  it('ignores host-claimed, composing, and repeated keydowns', () => {
    const callbacks = actions();
    renderHook(() => useOpenTriggers('ctrl+i', callbacks));
    const claimed = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true });
    claimed.preventDefault();
    fireEvent(document.body, claimed);
    expect(fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true, isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true, repeat: true })).toBe(true);
    expect(callbacks.toggle).not.toHaveBeenCalled();
  });

  it('delegates nested attribute clicks as user intent, but keeps CustomEvents programmatic', () => {
    const callbacks = actions();
    renderHook(() => useOpenTriggers(undefined, callbacks));
    render(
      <>
        <button data-mordn-chat-open><span>Open</span></button>
        <button data-mordn-chat-toggle><svg><title>Toggle</title></svg></button>
        <button data-mordn-chat-close>Close</button>
      </>,
    );
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByTitle('Toggle'));
    fireEvent.click(screen.getByText('Close'));
    expect(callbacks.open).toHaveBeenCalledExactlyOnceWith('user');
    expect(callbacks.toggle).toHaveBeenCalledExactlyOnceWith('user');
    expect(callbacks.close).toHaveBeenCalledExactlyOnceWith();

    fireEvent(document, new CustomEvent('mordn-chat:open'));
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    fireEvent(document, new CustomEvent('mordn-chat:close'));
    expect(callbacks.open).toHaveBeenLastCalledWith('programmatic');
    expect(callbacks.toggle).toHaveBeenLastCalledWith('programmatic');
    expect(callbacks.close).toHaveBeenCalledTimes(2);
  });

  it('uses fresh callbacks on rerender and removes every listener on unmount', () => {
    const initial = actions();
    const updated = actions();
    const { rerender, unmount } = renderHook(
      ({ shortcut, callbacks }) => useOpenTriggers(shortcut, callbacks),
      { initialProps: { shortcut: 'ctrl+i', callbacks: initial } },
    );
    render(<button data-mordn-chat-open>Open</button>);
    rerender({ shortcut: 'ctrl+k', callbacks: updated });
    fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('Open'));
    fireEvent(document, new CustomEvent('mordn-chat:close'));
    expect(initial.open).not.toHaveBeenCalled();
    expect(initial.close).not.toHaveBeenCalled();
    expect(initial.toggle).not.toHaveBeenCalled();
    expect(updated.open).toHaveBeenCalledTimes(1);
    expect(updated.close).toHaveBeenCalledTimes(1);
    expect(updated.toggle).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('Open'));
    fireEvent(document, new CustomEvent('mordn-chat:open'));
    fireEvent(document, new CustomEvent('mordn-chat:close'));
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    expect(updated.open).toHaveBeenCalledTimes(1);
    expect(updated.close).toHaveBeenCalledTimes(1);
    expect(updated.toggle).toHaveBeenCalledTimes(1);
  });
});

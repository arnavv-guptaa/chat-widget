/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWidget, type ChatWidgetHandle } from '../src/ChatWidget';
import type { AgentBootstrap, AgentConfig } from '../src/config';

// Exercise the real widget state/gate and trigger hook, not chat transport or
// rich rendering (in particular, do not pull Mermaid into these regressions).
vi.mock('../src/components/interface', () => ({
  default: ({ onClose }: { onClose?: () => void }) => <button onClick={onClose}>Dismiss chat</button>,
}));

const storageScope = 'trigger-test-scope';
const panelKey = `chat-${storageScope}-panel-open`;
const bootstrap: AgentBootstrap = {
  protocolVersion: 1,
  agent: 'trigger-test-agent',
  revision: 'trigger-test-revision',
  storageScope,
  client: {},
};

function config(allowAutoReopen?: boolean): AgentConfig {
  return {
    schemaVersion: 1,
    runtime: { model: 'test/model', systemPrompt: 'Test' },
    client: { allowAutoReopen, display: { keyboardShortcut: 'mod+i' } },
  };
}

function PageButtons() {
  return (
    <>
      <button data-mordn-chat-open><span>Page open</span></button>
      <button data-mordn-chat-toggle><span>Page toggle</span></button>
      <button data-mordn-chat-close>Page close</button>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => bootstrap })));
  // Skip animation/focus timing; the assertions concern state, not choreography.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('ChatWidget explicit open triggers (#245)', () => {
  it.each(['shortcut', 'open', 'toggle'])('reopens after dismissal via %s with allowAutoReopen false and persists it', async (trigger) => {
    const onStateChange = vi.fn();
    render(<><ChatWidget config={config(false)} onStateChange={onStateChange} /><PageButtons /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open chat' }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss chat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(panelKey)).toBe('closed');

    if (trigger === 'shortcut') fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true });
    else fireEvent.click(screen.getByText(`Page ${trigger}`)); // nested span delegates to button

    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(window.localStorage.getItem(panelKey)).toBe('open');
    expect(onStateChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('opens with the default gate off after hydrating a persisted dismissal', async () => {
    window.localStorage.setItem(panelKey, 'closed');
    const onStateChange = vi.fn();
    render(<ChatWidget config={config()} onStateChange={onStateChange} />);
    await screen.findByRole('button', { name: 'Open chat' });
    expect(onStateChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(onStateChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([undefined, false])('keeps ref and CustomEvent opening suppressed when allowAutoReopen is %s', async (allowAutoReopen) => {
    const ref = createRef<ChatWidgetHandle>();
    const onStateChange = vi.fn();
    render(<><ChatWidget ref={ref} config={config(allowAutoReopen)} onStateChange={onStateChange} /><PageButtons /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss chat' }));
    onStateChange.mockClear();

    act(() => ref.current?.open());
    act(() => ref.current?.toggle());
    fireEvent(document, new CustomEvent('mordn-chat:open'));
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    expect(ref.current?.isOpen).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onStateChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(panelKey)).toBe('closed');

    // Programmatic closing remains allowed even while opening is gated.
    fireEvent.click(screen.getByText('Page open'));
    act(() => ref.current?.close());
    expect(ref.current?.isOpen).toBe(false);
    fireEvent.click(screen.getByText('Page open'));
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    expect(ref.current?.isOpen).toBe(false);
    fireEvent.click(screen.getByText('Page open'));
    fireEvent(document, new CustomEvent('mordn-chat:close'));
    expect(ref.current?.isOpen).toBe(false);
  });

  it('still allows programmatic opens when explicitly opted in', async () => {
    const ref = createRef<ChatWidgetHandle>();
    render(<ChatWidget ref={ref} config={config(true)} />);
    await screen.findByRole('button', { name: 'Open chat' });
    act(() => ref.current?.open());
    expect(ref.current?.isOpen).toBe(true);
    act(() => ref.current?.toggle());
    expect(ref.current?.isOpen).toBe(false);
    act(() => ref.current?.toggle());
    expect(ref.current?.isOpen).toBe(true);
    fireEvent(document, new CustomEvent('mordn-chat:close'));
    fireEvent(document, new CustomEvent('mordn-chat:open'));
    expect(ref.current?.isOpen).toBe(true);
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    expect(ref.current?.isOpen).toBe(false);
    fireEvent(document, new CustomEvent('mordn-chat:toggle'));
    expect(ref.current?.isOpen).toBe(true);
  });

  it('delegates explicit controlled-mode changes without persisting host state', async () => {
    const onOpenChange = vi.fn();
    const onStateChange = vi.fn();
    function ControlledHost() {
      const [open, setOpen] = useState(true);
      return <ChatWidget config={config(false)} open={open} onStateChange={onStateChange} onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }} />;
    }
    render(<><ControlledHost /><PageButtons /></>);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByText('Page close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent(document, new CustomEvent('mordn-chat:open'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'i', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.click(screen.getByText('Page toggle'));
    fireEvent.click(screen.getByText('Page open'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[false], [true], [false], [true]]);
    expect(onStateChange.mock.calls).toEqual(onOpenChange.mock.calls);
    expect(window.localStorage.getItem(panelKey)).toBeNull();
  });
});

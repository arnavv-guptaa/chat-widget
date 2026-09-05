/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWidget } from '../src/ChatWidget';
import type { AgentBootstrap, AgentConfig } from '../src/config';
import type { MessagePartRenderers } from '../src/types';

const captured = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));
vi.mock('../src/components/interface', () => ({
  default: ({ config }: { config: Record<string, unknown> }) => {
    captured.configs.push(config);
    const renderers = config.messagePartRenderers as MessagePartRenderers | undefined;
    return <div>{renderers?.['data-card']?.({ type: 'data-card', data: {} }, { messageId: 'm1', role: 'assistant', isStreaming: false }) ?? 'Default interface'}</div>;
  },
}));
const bootstrap: AgentBootstrap = {
  protocolVersion: 1, agent: 'renderer-test', revision: 'r1', storageScope: 'renderers', client: {},
};
const config: AgentConfig = {
  schemaVersion: 1,
  runtime: { model: 'test/model', systemPrompt: 'Server policy' },
  client: { display: { layout: 'inline' } },
};

beforeEach(() => {
  captured.configs.length = 0;
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => bootstrap })));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChatWidget host-only renderer propagation', () => {
  it('updates interface config on renderer-map replacement without changing canonical request config', async () => {
    const first = { 'data-card': () => <span>First card</span> } satisfies MessagePartRenderers;
    const second = { 'data-card': () => <span>Second card</span> } satisfies MessagePartRenderers;
    const { rerender } = render(<ChatWidget config={config} messagePartRenderers={first} />);
    await screen.findByText('First card');
    expect(captured.configs.at(-1)?.messagePartRenderers).toBe(first);
    expect(captured.configs.at(-1)?.requestConfig).toBe(config);
    expect(JSON.stringify(config)).not.toContain('messagePartRenderers');
    rerender(<ChatWidget config={config} messagePartRenderers={second} />);
    await screen.findByText('Second card');
    expect(captured.configs.at(-1)?.messagePartRenderers).toBe(second);
    rerender(<ChatWidget config={config} />);
    await screen.findByText('Default interface');
    expect(captured.configs.at(-1)?.messagePartRenderers).toBeUndefined();
  });
});

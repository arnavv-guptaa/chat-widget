/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState, type ReactNode } from 'react';
import type { UIMessage } from 'ai';
import type { MessagePartRenderer, MessagePartRenderers } from '../src/index';
import { MessageItem } from '../src/components/message-item';
import { AgentTurnTranscript } from '../src/components/transcript/AgentTurnTranscript';
import { getMessagePartRenderer } from '../src/utils/message-part-renderers';
import { hasRenderableAssistantContent, messagesForTranscript } from '../src/utils/assistant-content';
import { accountLookupRenderers } from '../docs/examples/account-lookup';

// Keep the real message/assistant composition and memo boundaries. Stub heavy
// markdown and peripheral controls so this seam test does not import Mermaid.
vi.mock('../src/components/response', () => ({
  Response: ({ children, isStreaming, sources }: { children: ReactNode; isStreaming?: boolean; sources?: unknown[] }) =>
    <span data-response data-streaming={String(!!isStreaming)} data-sources={sources?.length}>{children}</span>,
}));
vi.mock('../src/components/message-actions', () => ({ MessageActions: () => null }));
vi.mock('../src/components/message-attachments', () => ({
  MessageAttachments: ({ attachments }: { attachments: { filename: string }[] }) =>
    <div data-attachments>{attachments.map((a) => a.filename).join(',')}</div>,
}));
vi.mock('../src/components/transcript/AgentToolCall', () => ({
  AgentToolCall: ({ verb, detail }: { verb: string; detail?: string }) => <div data-tool>{verb}{detail}</div>,
}));
vi.mock('../src/components/transcript/AgentThinkingTool', () => ({
  AgentThinkingTool: ({ text }: { text: string }) => <div data-reasoning>{text}</div>,
}));

afterEach(cleanup);
const part = { type: 'data-account-lookup', id: 'account-42', data: { name: 'Acme', accountId: 'acct_42', plan: 'Business' } } as const;
const message = (parts: UIMessage['parts'], role: UIMessage['role'] = 'assistant'): UIMessage => ({ id: 'm1', role, parts });
const props = { isFirst: true, isLast: true, status: 'ready' as const };

function StatefulCard({ streaming }: { streaming: boolean }) {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>{count}:{String(streaming)}</button>;
}

function transcript(m: UIMessage, renderers?: MessagePartRenderers, isStreaming = false, isLast = true) {
  return <AgentTurnTranscript message={m} messagePartRenderers={renderers} isStreaming={isStreaming} isLast={isLast} turn={isStreaming ? 'streaming' : 'done'} />;
}

describe('custom message-part renderer seam', () => {
  it('renders assistant custom data inline in order without replacing text/reasoning/tools', () => {
    const renderers = { 'data-account-lookup': () => <div data-card>Account card</div> } satisfies MessagePartRenderers;
    const m = message([
      { type: 'text', text: 'Before' }, part,
      { type: 'reasoning', text: 'Reasoning' },
      { type: 'tool-lookup', toolCallId: 't1', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'After' },
    ]);
    const { container } = render(transcript(m, renderers));
    expect([...container.querySelectorAll('[data-response], [data-card], [data-reasoning], [data-tool]')].map((el) => el.textContent))
      .toEqual(['Before', 'Account card', 'Reasoning', expect.any(String), 'After']);
  });

  it.each(['assistant', 'user', 'system'] as const)('passes original part and %s message context', (role) => {
    const renderer = vi.fn(() => <span>Custom</span>);
    render(<MessageItem {...props} message={message([part], role)} messagePartRenderers={{ 'data-account-lookup': renderer }} />);
    expect(renderer).toHaveBeenCalledWith(part, { messageId: 'm1', role, isStreaming: false });
  });

  it('only marks the active flowing assistant stream as streaming', () => {
    const renderer = vi.fn<MessagePartRenderer>(() => null);
    const renderers = { 'data-account-lookup': renderer };
    const m = message([part]);
    const { rerender } = render(transcript(m, renderers, true));
    expect(renderer.mock.calls.at(-1)).toEqual([part, { messageId: 'm1', role: 'assistant', isStreaming: true }]);
    rerender(transcript(m, renderers, true, false));
    expect(renderer.mock.calls.at(-1)?.[1]).toEqual({ messageId: 'm1', role: 'assistant', isStreaming: false });
    rerender(<MessageItem {...props} message={m} status="error" messagePartRenderers={renderers} />);
    expect(renderer.mock.calls.at(-1)?.[1]).toEqual({ messageId: 'm1', role: 'assistant', isStreaming: false });
  });

  it('re-renders on a replaced map and immutable streaming part updates through both memo boundaries', () => {
    const m = message([part]);
    const first = { 'data-account-lookup': () => <span>First renderer</span> } satisfies MessagePartRenderers;
    const next = { 'data-account-lookup': (p) => <span>New {String((p.data as { name: string }).name)}</span> } satisfies MessagePartRenderers;
    const { container, rerender } = render(<MessageItem {...props} message={m} messagePartRenderers={first} />);
    expect(container.textContent).toContain('First renderer');
    rerender(<MessageItem {...props} message={m} messagePartRenderers={next} />);
    expect(container.textContent).toContain('New Acme');
    rerender(<MessageItem {...props} status="streaming" message={message([{ ...part, data: { ...part.data, name: 'Updated' } }])} messagePartRenderers={next} />);
    expect(container.textContent).toContain('New Updated');
    rerender(<MessageItem {...props} message={m} />);
    expect(container.textContent).not.toContain('New');
  });

  it('preserves a returned component hook state across stream stop and resume', () => {
    const renderers = { [part.type]: (_part, context) => <StatefulCard streaming={context.isStreaming} /> } satisfies MessagePartRenderers;
    const m = message([part]);
    const { getByRole, rerender } = render(<MessageItem {...props} message={m} status="streaming" messagePartRenderers={renderers} />);
    fireEvent.click(getByRole('button'));
    expect(getByRole('button').textContent).toBe('1:true');
    rerender(<MessageItem {...props} message={m} messagePartRenderers={renderers} />);
    expect(getByRole('button').textContent).toBe('1:false');
    rerender(<MessageItem {...props} message={message([{ ...part, data: { ...part.data, plan: 'Updated' } }])} status="streaming" messagePartRenderers={renderers} />);
    expect(getByRole('button').textContent).toBe('1:true');
  });

  it.each([undefined, { 'data-account-lookup': () => null }, { 'data-account-lookup': () => undefined }])('omits unknown/declined data without leaking JSON or swallowing adjacent text', (renderers) => {
    const { container } = render(transcript(message([{ type: 'text', text: 'Safe fallback' }, part]), renderers));
    expect(container.textContent).toBe('Safe fallback');
    expect(container.innerHTML).not.toContain('acct_42');
  });

  it('preserves the last text streaming flag when trailing data is unregistered', () => {
    const { container } = render(transcript(message([{ type: 'text', text: 'Streaming' }, part]), undefined, true));
    expect(container.querySelector('[data-response]')?.getAttribute('data-streaming')).toBe('true');
  });

  it('cannot redirect built-ins or reserved metadata, even through untyped input', () => {
    const renderer = vi.fn(() => <span>Override</span>);
    for (const type of ['text', 'source-url', 'file', 'reasoning', 'tool-lookup', 'dynamic-tool', 'data-follow-ups', 'data-thread-title', 'data-chat-error', 'data-']) {
      expect(getMessagePartRenderer({ type, data: {} } as typeof part, { [type]: renderer })).toBeUndefined();
    }
    expect(getMessagePartRenderer({ type: part.type }, { [part.type]: renderer })).toBeUndefined();
    expect(getMessagePartRenderer(part, Object.create({ [part.type]: renderer }))).toBeUndefined();
    expect(getMessagePartRenderer(part, { [part.type]: 'not code' } as unknown as MessagePartRenderers)).toBeUndefined();
    expect(renderer).not.toHaveBeenCalled();
  });

  it.each(['assistant', 'user', 'system'] as const)('never dispatches reserved or transient replay data for %s', (role) => {
    const renderer = vi.fn(() => <span>Internal metadata leaked</span>);
    const transient = { ...part, transient: true };
    const reserved = ['data-follow-ups', 'data-thread-title', 'data-chat-error'].map((type) => ({ type, data: { secret: 'private' } }));
    const renderers = Object.fromEntries([...reserved, part].map((p) => [p.type, renderer]));
    const m = message([{ type: 'text', text: 'Safe text' }, ...reserved, transient] as UIMessage['parts'], role);
    const { container } = render(<MessageItem {...props} message={m} messagePartRenderers={renderers} />);
    expect(container.textContent).toBe('Safe text');
    expect(renderer).not.toHaveBeenCalled();
    expect(getMessagePartRenderer(transient, renderers)).toBeUndefined();
    expect(hasRenderableAssistantContent(message([transient]), renderers)).toBe(false);
  });

  it('keeps completed static and dynamic tool output when both legacy renderers decline', () => {
    const output = { confirmation: 'Saved account 42' };
    const m = message([
      part,
      { type: 'tool-save', toolCallId: 't1', state: 'output-available', input: {}, output },
      { type: 'dynamic-tool', toolName: 'lookup', toolCallId: 't2', state: 'output-available', input: {}, output: 'Lookup complete' },
    ]);
    const tool = vi.fn(() => null);
    const action = vi.fn(() => null);
    const { container } = render(<MessageItem {...props} message={m} messagePartRenderers={accountLookupRenderers}
      toolRenderers={{ save: tool, lookup: tool }} actionRenderers={{ save: action, lookup: action }} />);
    expect(tool).toHaveBeenCalledWith(expect.objectContaining({ output, state: 'output-available' }));
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ output: 'Lookup complete' }));
    expect(container.textContent).toContain('Saved account 42');
    expect(container.textContent).toContain('Lookup complete');
  });

  it('keeps attachment placement and citations when a custom card is present', () => {
    const m = message([
      { type: 'file', filename: 'statement.pdf', mediaType: 'application/pdf', url: 'https://example.com/statement.pdf' },
      { type: 'source-url', sourceId: 's1', url: 'https://example.com', title: 'Source' },
      { type: 'text', text: 'Answer [1]' }, part,
    ]);
    const { container } = render(<MessageItem {...props} message={m} messagePartRenderers={accountLookupRenderers} />);
    expect(container.querySelector('[data-attachments]')?.textContent).toBe('statement.pdf');
    expect(container.querySelector('[data-response]')?.getAttribute('data-sources')).toBe('1');
    expect(container.textContent).toContain('Acme');
  });

  it('retains toolRenderers and actionRenderers alongside custom data', () => {
    const m = message([
      part,
      { type: 'tool-lookup', toolCallId: 't1', state: 'output-available', input: {}, output: {} },
      { type: 'tool-save', toolCallId: 't2', state: 'output-available', input: {}, output: {} },
    ]);
    const { container } = render(<MessageItem {...props} message={m} messagePartRenderers={accountLookupRenderers}
      toolRenderers={{ lookup: () => <span>Custom tool</span> }}
      actionRenderers={{ save: () => ({ status: 'success', title: 'Saved result' }) }} />);
    expect(container.textContent).toContain('Acme');
    expect(container.textContent).toContain('Custom tool');
    expect(container.textContent).toContain('Saved result');
  });

  it('renders persisted/replayed parts with the same SSR-safe example and no streaming status', () => {
    const m: UIMessage = JSON.parse(JSON.stringify(message([part])));
    const html = renderToStaticMarkup(<MessageItem {...props} message={m} messagePartRenderers={accountLookupRenderers} />);
    expect(html).toContain('Account lookup result');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('acct_42');
    expect(html).toContain('--chat-text');
    expect(renderToStaticMarkup(transcript(message([{ ...part, data: null }]), accountLookupRenderers))).not.toContain('Account lookup result');
    const malicious = { ...part, data: { ...part.data, name: '<script>alert(1)</script>' } };
    expect(renderToStaticMarkup(transcript(message([malicious]), accountLookupRenderers))).toContain('&lt;script&gt;');
  });

  it('admits data-only streaming turns without calling host renderers during planning detection', () => {
    const renderer = vi.fn<MessagePartRenderer>(() => null);
    const renderers = { [part.type]: renderer };
    const m = message([part]);
    expect(hasRenderableAssistantContent(m)).toBe(false);
    expect(hasRenderableAssistantContent(m, renderers)).toBe(true);
    const list = [m];
    expect(messagesForTranscript(list, true, renderers)).toBe(list);
    expect(messagesForTranscript(list, true)).toEqual([]);
    for (const type of ['data-follow-ups', 'data-thread-title', 'data-chat-error']) {
      expect(hasRenderableAssistantContent(message([{ type, data: {} } as UIMessage['parts'][number]]), { [type]: renderer })).toBe(false);
    }
    expect(renderer).not.toHaveBeenCalled();
  });
});

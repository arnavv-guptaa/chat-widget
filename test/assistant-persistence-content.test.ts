import { describe, expect, it } from 'vitest';
import { hasAssistantContent } from '../src/server/assistant-content';
import { isCustomMessageDataPart } from '../src/utils/custom-message-data';

const assistant = (parts: unknown) => [{ role: 'assistant', parts }];

describe('assistant persistence eligibility', () => {
  it.each([null, false, 0, '', [], { accountId: 'a-1' }])(
    'keeps a custom data-only turn with payload %j, without a renderer',
    (data) => {
      const part = { type: 'data-account-lookup', data };
      expect(isCustomMessageDataPart(part)).toBe(true);
      expect(hasAssistantContent(assistant([part]))).toBe(true);
    },
  );

  it.each([
    { type: 'data-account-lookup' },
    { type: 'data-account-lookup', transient: true, data: { status: 'loading' } },
    { type: 'data-follow-ups', data: { suggestions: ['Next?'] } },
    { type: 'data-thread-title', data: { title: 'Account' } },
    { type: 'data-chat-error', data: { message: 'Failed' } },
    { type: 'data-', data: {} },
    { type: 'step-start' },
  ])('does not save a control/transient/malformed-only turn: %j', (part) => {
    expect(isCustomMessageDataPart(part)).toBe(false);
    expect(hasAssistantContent(assistant([part]))).toBe(false);
  });

  it('requires an own data field, not an inherited payload', () => {
    const part = Object.assign(Object.create({ data: { forged: true } }), { type: 'data-account-lookup' });
    expect(isCustomMessageDataPart(part)).toBe(false);
    expect(hasAssistantContent(assistant([part]))).toBe(false);
  });

  it('treats the check as eligibility, never authentication or payload validation', () => {
    const clientSupplied = JSON.parse('{"type":"data-account-lookup","data":{"authorized":true}}');
    // Passing the same shape says nothing about where it came from. Consumers
    // must still validate payloads and enforce their own identity/permissions.
    expect(isCustomMessageDataPart(clientSupplied)).toBe(true);
  });

  it.each([
    { type: 'text', text: 'Answer' },
    { type: 'reasoning', text: 'Thinking' },
    { type: 'tool-lookup', toolCallId: 't-1' },
    { type: 'dynamic-tool', toolName: 'lookup', toolCallId: 't-1' },
    { type: 'source-url', sourceId: 's-1', url: 'https://example.com' },
    { type: 'file', mediaType: 'image/png', url: 'https://example.com/image.png' },
  ])('preserves existing content eligibility: %j', (part) => {
    expect(hasAssistantContent(assistant([part]))).toBe(true);
    expect(hasAssistantContent(assistant([{ type: 'data-chat-error', data: {} }, part]))).toBe(true);
  });

  it.each([undefined, null, [], {}, [null], [{ type: 'text', text: '  ' }], [{ type: 'reasoning', text: '' }]])(
    'does not save empty assistant parts: %j', (parts) => {
      expect(hasAssistantContent(assistant(parts))).toBe(false);
    },
  );

  it('examines only the final assistant, not prior output or user data', () => {
    const parts = [{ type: 'data-account-lookup', data: {} }];
    expect(hasAssistantContent([])).toBe(false);
    expect(hasAssistantContent([{ role: 'user', parts }])).toBe(false);
    expect(hasAssistantContent([...assistant(parts), ...assistant([])])).toBe(false);
    expect(hasAssistantContent([...assistant(parts), { role: 'user', parts }])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  hasRenderableAssistantContent,
  messagesForTranscript,
} from '../src/utils/assistant-content';

function message(
  id: string,
  role: UIMessage['role'],
  parts: UIMessage['parts'],
): UIMessage {
  return { id, role, parts };
}

describe('assistant transcript content', () => {
  it('treats empty and whitespace-only text as non-renderable', () => {
    expect(
      hasRenderableAssistantContent(
        message('a1', 'assistant', [
          { type: 'step-start' },
          { type: 'text', text: '   \n  ' },
        ]),
      ),
    ).toBe(false);
  });

  it('recognizes text, reasoning, files, sources, and tools as renderable', () => {
    const parts = [
      { type: 'text', text: 'Answer' },
      { type: 'reasoning', text: 'Working' },
      { type: 'file' },
      { type: 'source-url' },
      { type: 'dynamic-tool' },
      { type: 'tool-lookup' },
    ] as unknown as UIMessage['parts'];

    for (const part of parts) {
      expect(hasRenderableAssistantContent(message('a1', 'assistant', [part]))).toBe(true);
    }
  });

  it('omits only the empty trailing assistant row while planning is visible', () => {
    const user = message('u1', 'user', [{ type: 'text', text: 'Question' }]);
    const emptyAssistant = message('a1', 'assistant', [{ type: 'step-start' }]);
    const messages = [user, emptyAssistant];

    expect(messagesForTranscript(messages, true)).toEqual([user]);
    expect(messagesForTranscript(messages, false)).toBe(messages);
  });

  it('keeps the assistant row as soon as its first renderable part arrives', () => {
    const user = message('u1', 'user', [{ type: 'text', text: 'Question' }]);
    const assistant = message('a1', 'assistant', [{ type: 'text', text: 'A' }]);
    const messages = [user, assistant];

    expect(messagesForTranscript(messages, true)).toBe(messages);
  });
});

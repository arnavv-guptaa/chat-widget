/**
 * Ready-made history summarizer for `createChatHandler({ summarizeHistory })`.
 *
 * When a conversation overflows the sliding window, the handler hands the DROPPED
 * (oldest) messages to `summarizeHistory`; this helper condenses them with a
 * small/fast model via the AI SDK (`generateText`) so the early thread survives
 * as a compact system-prompt block instead of being lost.
 *
 * Use a CHEAP model here — summarization runs only on overflow turns, but it's on
 * the request path, so latency/cost matter. Pass any AI SDK `LanguageModel` (a
 * gateway string like 'google/gemini-2.5-flash' works).
 *
 *   import { createLlmSummarizer } from '@mordn/chat-widget/server'
 *   createChatHandler({
 *     summarizeHistory: createLlmSummarizer({ model: 'google/gemini-2.5-flash' }),
 *   })
 *
 * Best-effort by contract: this returns '' on any failure (the handler then falls
 * back to a plain drop), so a summarizer hiccup never breaks a turn.
 */

import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import type { ChatRequestContext } from './handler-types';

export interface LlmSummarizerOptions {
  /** The (ideally small/fast) model used to summarize. */
  model: LanguageModel;
  /** Cap on the summary length the model is asked for. Default 1200. */
  maxChars?: number;
  /** Override the instruction if you want a domain-specific summary shape. */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM = [
  'You compress the EARLIER part of a chat conversation into a dense summary that',
  'preserves what later turns need: the user\'s goal/intent, decisions made, facts',
  'and constraints established, unresolved questions, and any context the assistant',
  'must not forget. Omit pleasantries and resolved small talk. Write terse notes,',
  'not prose. Do not invent anything not present in the messages.',
].join(' ');

/** Flatten a ModelMessage's content (string or content parts) to plain text. */
function messageText(m: ModelMessage): string {
  const content = (m as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        const x = p as { type?: string; text?: unknown };
        return x?.type === 'text' && typeof x.text === 'string' ? x.text : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

export function createLlmSummarizer(
  opts: LlmSummarizerOptions,
): (dropped: ModelMessage[], ctx: ChatRequestContext) => Promise<string> {
  const maxChars = opts.maxChars ?? 1200;
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM;

  return async (dropped: ModelMessage[]): Promise<string> => {
    if (dropped.length === 0) return '';
    const transcript = dropped
      .map((m) => {
        const role = (m as { role?: string }).role ?? 'user';
        const text = messageText(m).trim();
        return text ? `${role}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
    if (!transcript) return '';

    try {
      const { text } = await generateText({
        model: opts.model,
        system,
        prompt:
          `Summarize this earlier conversation in under ${maxChars} characters of terse notes:\n\n` +
          transcript,
      });
      return (text ?? '').trim().slice(0, maxChars);
    } catch {
      // Best-effort: the handler falls back to a plain drop on ''.
      return '';
    }
  };
}

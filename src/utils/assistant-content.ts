import type { UIMessage } from 'ai';
import type { MessagePartRenderers } from '../types';
import { getMessagePartRenderer } from './message-part-renderers';

/**
 * Whether an assistant message currently has anything the transcript can paint.
 * Keep this aligned with MessageItem / AgentTurnTranscript: metadata-only parts
 * such as step-start and data-follow-ups must not dismiss the planning state.
 */
export function hasRenderableAssistantContent(
  message: UIMessage | undefined,
  messagePartRenderers?: MessagePartRenderers,
): boolean {
  if (message?.role !== 'assistant') return false;

  return (message.parts ?? []).some((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      return part.text.trim().length > 0;
    }

    return (
      part.type === 'source-url' ||
      part.type === 'file' ||
      part.type === 'dynamic-tool' ||
      part.type.startsWith('tool-') ||
      // Registration opts the part into transcript ownership. Never invoke a
      // host render callback here (it may return null or a component).
      !!getMessagePartRenderer(part, messagePartRenderers)
    );
  });
}

/**
 * The AI SDK inserts an empty assistant message before the first streamed part.
 * While the global planning indicator owns that pre-content slot, omit the empty
 * row so MessageItem's turn spacing cannot move the indicator before content.
 */
export function messagesForTranscript(
  messages: UIMessage[],
  showPlanning: boolean,
  messagePartRenderers?: MessagePartRenderers,
): UIMessage[] {
  if (!showPlanning) return messages;

  const last = messages.at(-1);
  if (last?.role !== 'assistant' || hasRenderableAssistantContent(last, messagePartRenderers)) {
    return messages;
  }

  return messages.slice(0, -1);
}

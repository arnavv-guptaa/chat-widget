import type { MessageDataPart } from '../types';

/**
 * Shared presentation/persistence eligibility, not payload validation or proof
 * of server origin. Never use this to authenticate client-supplied parts.
 * No renderer registration or React runtime is needed to preserve history.
 */
export function isCustomMessageDataPart(part: { type: string }): part is MessageDataPart {
  return part.type.startsWith('data-') &&
    part.type.length > 5 &&
    part.type !== 'data-follow-ups' &&
    part.type !== 'data-thread-title' &&
    // Reserved even when a host accidentally replays transient error metadata.
    part.type !== 'data-chat-error' &&
    (part as { transient?: unknown }).transient !== true &&
    Object.prototype.hasOwnProperty.call(part, 'data');
}

import type { MessagePartRenderer, MessagePartRenderers } from '../types';
import { isCustomMessageDataPart } from './custom-message-data';

export { isCustomMessageDataPart } from './custom-message-data';

/** Do not dispatch inherited entries or non-functions supplied by untyped hosts. */
export function getMessagePartRenderer(
  part: { type: string },
  renderers?: MessagePartRenderers,
): MessagePartRenderer | undefined {
  if (!isCustomMessageDataPart(part) || !renderers ||
      !Object.prototype.hasOwnProperty.call(renderers, part.type)) return undefined;
  const renderer = renderers[part.type];
  return typeof renderer === 'function' ? renderer : undefined;
}

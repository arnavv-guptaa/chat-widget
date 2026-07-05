/**
 * mem0 memory adapter — public entry.
 *
 *   import { createMem0Memory } from '@mordn/chat-widget/server/memory/mem0';
 *   createChatHandler({
 *     memory: { adapter: createMem0Memory({ apiKey: process.env.MEM0_API_KEY, agentId: 'support-bot' }) },
 *   });
 *
 * Same handler, same /memory routes, same security as the Drizzle default — only
 * the backend changes. mem0 extracts + consolidates server-side, so no
 * extractionModel is needed.
 */
import 'server-only';

export { createMem0Memory, type Mem0Options } from './adapter';

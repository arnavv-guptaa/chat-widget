/**
 * Hosted memory adapter — public entry.
 *
 *   import { createHostedMemory } from '@mordn/chat-widget/server/memory/hosted';
 *   createChatHandler({
 *     memory: { adapter: createHostedMemory({ apiKey: process.env.MORDN_CHAT_KEY, agentId }) },
 *   });
 *
 * No DATABASE_URL, no pgvector, no extraction model — the hosted @mordn/chat-api
 * service owns extraction + storage. The only secret you hold is the tenant key.
 */
import 'server-only';

export { createHostedMemory, type HostedMemoryOptions } from './client';

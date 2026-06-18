/**
 * Hosted store/storage clients — public entry.
 *
 *   import { createHostedChatStore, createHostedStorage } from '@mordn/chat-widget/server/hosted';
 *   createChatHandler({
 *     getUserId,
 *     model,
 *     store:   createHostedChatStore({ apiKey: process.env.MORDN_CHAT_KEY }),
 *     storage: createHostedStorage({ apiKey: process.env.MORDN_CHAT_KEY }),
 *   });
 *
 * No DATABASE_URL, no bucket, no migrations — the hosted @mordn/chat-api service
 * owns all of that. The only secret you hold is the tenant API key.
 */
import 'server-only';

export { createHostedChatStore, createHostedStorage, type HostedOptions } from './store';

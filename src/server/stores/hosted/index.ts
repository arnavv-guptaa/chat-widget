/**
 * Hosted store/storage clients — public entry.
 *
 *   import { createMordnHandler } from '@mordn/chat-widget/server/hosted';
 *   createMordnHandler({
 *     apiKey: process.env.MORDN_CHAT_KEY,
 *     getUserId,
 *     // buildTools, retrieval, memory, hooks, etc.
 *   });
 *
 * No DATABASE_URL, no bucket, no migrations — the hosted @mordn/chat-api service
 * owns all of that. The only secret you hold is the tenant API key.
 */
import 'server-only';

export {
  createMordnHandler,
  type CreateMordnHandlerOptions,
  type MordnAdvancedOptions,
} from './mordn-handler';

export {
  createHostedChatStore,
  createHostedStorage,
  createHostedConfig,
  createHostedFeedback,
  type HostedOptions,
  type HostedFeedbackOptions,
} from './store';

/**
 * Hosted Knowledge retriever — public entry.
 *
 *   import { createHostedKnowledgeRetriever } from '@mordn/chat-widget/server/knowledge/hosted';
 *   createChatHandler({
 *     retrieval: {
 *       store: createHostedKnowledgeRetriever({ apiKey: process.env.MORDN_CHAT_KEY, agentId }),
 *       resolveNamespaces: () => [],   // hosted scopes by tenant + agentId
 *     },
 *   });
 *
 * No DATABASE_URL, no pgvector, no migrations — the hosted @mordn/chat-api
 * service owns ingestion + storage. The only secret you hold is the tenant key.
 */
import 'server-only';

export {
  createHostedKnowledgeRetriever,
  type HostedKnowledgeOptions,
} from './client';

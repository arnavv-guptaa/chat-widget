/**
 * Hosted Knowledge retriever — public entry.
 *
 *   import { createHostedKnowledgeRetriever } from '@mordn/chat-widget/server/knowledge/hosted';
 *   createChatHandler({
 *     retrieval: {
 *       store: createHostedKnowledgeRetriever({ apiKey: process.env.MORDN_CHAT_KEY }),
 *       resolveNamespaces: () => [],
 *     },
 *   });
 *
 * No DATABASE_URL, no pgvector, no migrations — the hosted @mordn/chat-api
 * service owns ingestion + storage. The API key is an agent key issued from
 * the dashboard; the server resolves the tenant and agent from it.
 */
import 'server-only';

export {
  createHostedKnowledgeRetriever,
  type HostedKnowledgeOptions,
} from './client';

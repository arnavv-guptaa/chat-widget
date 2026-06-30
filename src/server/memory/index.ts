/**
 * Memory public surface — interfaces + light, dependency-free helpers.
 *
 * Imported via `@mordn/chat-widget/server/memory`. Pulls NO heavy deps: just the
 * contract and the extraction helpers. The Postgres default adapter lives behind
 * `@mordn/chat-widget/server/memory/drizzle`; mem0 behind `…/memory/mem0`; the
 * hosted HTTP client behind `…/memory/hosted`.
 */
import 'server-only';

export type {
  Memory,
  MemoryScope,
  ListOptions,
  RetrieveOptions,
  RecordOptions,
  MemoryAdapter,
  MemoryAdapterFactory,
} from './types';

export {
  renderTurn,
  llmExtract,
  heuristicExtract,
  redactDelta,
  type MemoryDelta,
} from './extract';

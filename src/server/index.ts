/**
 * Server-core public surface.
 *
 * The pluggable contracts that define the widget's backend. Both the hosted
 * default and any BYO implementation satisfy these. The request router (added
 * next) depends only on these interfaces, never on a concrete DB/storage.
 *
 * Guarded by `server-only`: importing this into a client bundle is a build
 * error, since these types reference server-side concerns and the
 * implementations hold secrets (DB URLs, service keys).
 */
import 'server-only';

export type {
  StoredAttachment,
  StoredConversation,
  StoredMessage,
  ListMessagesOptions,
  SaveTurnInput,
} from './types';

export type { ChatStore, ChatStoreFactory } from './chat-store';
export { ConversationOwnershipError } from './chat-store';

export type {
  StorageAdapter,
  StorageAdapterFactory,
  UploadInput,
  UploadResult,
} from './storage-adapter';

export { createChatHandler } from './handler';
export type {
  CreateChatHandlerOptions,
  ChatRequestContext,
  HostedAgentConfig,
  BuiltTools,
  UploadPolicy,
} from './handler-types';

export {
  compressModelMessages,
  resolveCompression,
  normalizeCompression,
} from './compression';
export type {
  CompressionConfig,
  CompressionOption,
  CompressionResult,
  CompressionSkipReason,
} from './compression';

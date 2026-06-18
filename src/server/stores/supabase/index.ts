/**
 * Default Supabase Storage adapter — public entry.
 *
 * Imported via `@mordn/chat-widget/server/supabase` so a BYO-storage consumer
 * never pulls `@supabase/supabase-js` into their bundle.
 *
 *   import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';
 *   createChatHandler({ storage: createSupabaseStorage(), ... });
 */
import 'server-only';

export { createSupabaseStorage, type SupabaseStorageOptions } from './storage';

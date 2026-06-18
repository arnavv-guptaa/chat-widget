/**
 * Postgres connection for the default Drizzle store.
 *
 * Carries forward the connection hygiene the original package got right:
 *   • cache the client on globalThis so Next.js dev HMR doesn't leak a fresh
 *     pool on every reload (which eventually exhausts Supabase's pooler),
 *   • `prepare: false` for the Supabase transaction-mode pooler,
 *   • a small, bounded pool.
 *
 * The connection string is read from `DATABASE_URL` by default but can be
 * passed explicitly so a host app with multiple databases stays in control.
 */

import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export interface DrizzleClientOptions {
  /** Postgres connection string. Defaults to `process.env.DATABASE_URL`. */
  connectionString?: string;
  /** Max pool connections. Defaults to 5 (dev-friendly; raise in prod). */
  max?: number;
}

const globalForDb = globalThis as unknown as {
  __mordnChatWidgetDb?: Map<string, DrizzleDb>;
};

/**
 * Get (or lazily create + cache) a Drizzle db for a connection string. Cached
 * by connection string so multiple stores over the same DB share one pool.
 */
export function getDrizzleDb(options: DrizzleClientOptions = {}): DrizzleDb {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[chat-widget] DATABASE_URL is not set and no connectionString was ' +
        'provided to the default Drizzle store.',
    );
  }

  const cache = (globalForDb.__mordnChatWidgetDb ??= new Map());
  const cached = cache.get(connectionString);
  if (cached) return cached;

  const client = postgres(connectionString, {
    prepare: false, // required for Supabase transaction-mode pooler
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });

  // Only cache in non-prod: in prod each server instance loads the module once
  // so caching buys nothing and would pin a pool across the process lifetime.
  if (process.env.NODE_ENV !== 'production') cache.set(connectionString, db);
  return db;
}

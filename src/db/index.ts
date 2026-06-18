import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Cache the postgres client on globalThis so Next.js dev (HMR) doesn't
// leak a fresh pool on every code reload — without this, each hot
// reload accumulates open sockets against Supabase's pooler and you
// eventually hit "max clients reached in session mode". In production
// the module is loaded once per server instance so the cache is a
// no-op there.
const connectionString = process.env.DATABASE_URL!;

const globalForDb = globalThis as unknown as {
  __mordnChatWidgetPg?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__mordnChatWidgetPg ??
  postgres(connectionString, {
    // Disable prefetch — required for Supabase Transaction-mode pooler.
    prepare: false,
    // Keep dev's connection footprint small. Override at the env level
    // (DATABASE_URL or equivalent) for prod.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__mordnChatWidgetPg = client;
}

// Create drizzle database instance
export const db = drizzle(client, { schema });

// Export schema for convenience
export * from './schema';

// Export chat store functions
export * from './chat-store';

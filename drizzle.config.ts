import { defineConfig } from 'drizzle-kit';

// Repository development config for the current default ChatStore only.
// Not a consumer upgrade runner; see docs/self-hosted-migrations.md.
export default defineConfig({
  schema: './src/server/stores/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

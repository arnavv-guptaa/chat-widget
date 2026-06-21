import { defineConfig } from 'tsup';

export default defineConfig([
  // Client components (ChatWidget, ChatInterface, etc.)
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'next'],
    esbuildOptions(options) {
      options.banner = {
        js: '"use client";',
      };
    },
  },
  // Server-only code (db, api) - no "use client", externalize node modules
  {
    entry: {
      // Pure data (supported model list) — no "use client", safe to import from
      // server actions or client components. Exposed as '@mordn/chat-widget/models'.
      'models': 'src/utils/models.ts',
      'db/index': 'src/db/index.ts',
      'api/index': 'src/api/index.ts',
      'schema/index': 'src/schema/index.ts',
      'server/index': 'src/server/index.ts',
      'server/drizzle/index': 'src/server/stores/drizzle/index.ts',
      'server/supabase/index': 'src/server/stores/supabase/index.ts',
      'server/hosted/index': 'src/server/stores/hosted/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false, // Don't clean since first config already cleaned
    external: [
      'react',
      'react-dom',
      'next',
      'ai',
      'postgres',
      'drizzle-orm',
      'drizzle-orm/postgres-js',
      '@supabase/supabase-js',
      'server-only',
    ],
  },
  // CLI tool
  {
    entry: {
      'cli/init': 'src/cli/init.ts',
    },
    format: ['cjs'],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    target: 'node18',
    platform: 'node',
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

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
    // Keep React/Next external (host-provided), and also externalize the AI SDK
    // runtime so the host's single instance is used. `ai` is a peerDependency and
    // `@ai-sdk/react` (which depends on `ai` internally) is promoted to a peerDep
    // too — bundling either creates a duplicate, private copy of the AI SDK whose
    // object/context identity disagrees with the host's copy (broken instanceof
    // checks, duplicate React context, extra bundle weight). esbuild matches exact
    // specifiers, so the bare `ai` entry covers the only specifier imported here.
    external: ['react', 'react-dom', 'next', 'ai', '@ai-sdk/react'],
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
    // All peer/runtime deps the host provides must stay external so a single
    // shared instance is used. esbuild matches EXACT specifiers unless a `/*`
    // wildcard is given: a bare `drizzle-orm` entry does NOT cover subpaths like
    // `drizzle-orm/pg-core` or `drizzle-orm/postgres-js`. Drizzle column/table
    // objects rely on prototype identity for query building, so a bundled second
    // copy of `pg-core` produces malformed SQL / runtime errors against the host's
    // drizzle instance. We therefore externalize both the bare package AND every
    // subpath via `drizzle-orm/*`. Used subpaths today: pg-core, postgres-js.
    external: [
      'react',
      'react-dom',
      'next',
      'ai',
      '@ai-sdk/react',
      'postgres',
      'drizzle-orm',
      'drizzle-orm/*',
      'drizzle-orm/pg-core',
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

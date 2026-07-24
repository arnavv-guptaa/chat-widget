import { defineConfig } from 'tsup';
// Read the package version for the embed's CSS-fallback URL define. `resolveJsonModule`
// is on (tsup/esbuild resolves JSON natively), and this is build-time-only config.
import pkg from './package.json';

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
      // Canonical serializable config contract shared by chat-widget, chat-api,
      // and chat-web without importing the client component entry.
      'config/index': 'src/config.ts',
      // Action/template manifests and types — server-safe data contracts used by
      // dashboard/docs/server code without importing the client component entry.
      'actions/index': 'src/actions/index.ts',
      'db/index': 'src/db/index.ts',
      'api/index': 'src/api/index.ts',
      'schema/index': 'src/schema/index.ts',
      'server/index': 'src/server/index.ts',
      'server/drizzle/index': 'src/server/stores/drizzle/index.ts',
      'server/supabase/index': 'src/server/stores/supabase/index.ts',
      'server/hosted/index': 'src/server/stores/hosted/index.ts',
      // Knowledge (RAG): interfaces + ingestion (light), pgvector default, hosted client.
      'server/knowledge/index': 'src/server/knowledge/index.ts',
      'server/knowledge/drizzle/index': 'src/server/stores/knowledge-drizzle/index.ts',
      'server/knowledge/hosted/index': 'src/server/stores/knowledge-hosted/index.ts',
      // Memory: interface + extraction (light), pgvector default, mem0 + hosted clients.
      'server/memory/index': 'src/server/memory/index.ts',
      'server/memory/drizzle/index': 'src/server/stores/memory-drizzle/index.ts',
      'server/memory/mem0/index': 'src/server/stores/memory-mem0/index.ts',
      'server/memory/hosted/index': 'src/server/stores/memory-hosted/index.ts',
      // MCP (Model Context Protocol): connect agent tools from remote MCP servers.
      'server/mcp/index': 'src/server/mcp.ts',
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
      '@ai-sdk/mcp',
      '@ai-sdk/react',
      'postgres',
      'drizzle-orm',
      'drizzle-orm/*',
      'drizzle-orm/pg-core',
      'drizzle-orm/postgres-js',
      '@supabase/supabase-js',
      'server-only',
      'node:crypto',
      'node:dns/promises',
      'node:net',
      // undici ships inside Node 18+ (global fetch is undici-backed); keep it
      // external so the SSRF-safe loader resolves it at runtime instead of
      // bundling it (it isn't a declared dependency).
      'undici',
    ],
  },
  // CLI tool (chat-widget init + knowledge ingest/sync/status/list)
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
    // The CLI lazily `import('@mordn/chat-widget/server/knowledge')` at RUNTIME
    // (deferred so the lightweight `init` command never loads the heavy ingest
    // code). That self-reference is unresolvable at BUILD time — the package
    // isn't installed in its own node_modules — so mark it external: leave the
    // import untouched and let Node resolve it via the package `exports` map
    // when a consumer runs `npx chat-widget`. Without this the build fails and
    // (via the `&&` chain) the CSS build never runs.
    external: [/^@mordn\/chat-widget(\/.*)?$/],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Script-tag embed — a self-contained IIFE for non-React sites (issue #192).
  //
  // This is the OPPOSITE of the library entry above: instead of externalizing
  // React and the widget's deps so the host provides them, we bundle EVERYTHING
  // (`noExternal: [/.*/]`) so a plain `<script>` on a docs site with no bundler
  // and no React still gets a working widget. Output: `dist/embed.global.js`.
  //
  // Entry NAMING: the key is `embed` (not `embed.global`). tsup's default JS
  // extension for the `iife` format is already `.global.js`, so `embed` →
  // `dist/embed.global.js`. Naming the key `embed.global` would instead emit
  // `dist/embed.global.global.js` (double suffix). Keep it as `embed`.
  //
  // NO "use client" banner here — this bundle IS the React tree; there is no
  // outer RSC boundary to annotate (unlike the library `index` entry).
  {
    entry: {
      embed: 'src/embed/index.tsx',
    },
    format: ['iife'],
    platform: 'browser',
    target: 'es2019',
    minify: true,
    sourcemap: false,
    dts: false,
    clean: false, // The first (library) config already cleaned dist/.
    // Bundle React, ReactDOM, and every widget dependency IN — the whole point
    // of the embed is zero host dependencies.
    noExternal: [/.*/],
    // ...EXCEPT shiki (DOCS_CONTRACT §6). Marking it external makes esbuild
    // leave the sibling highlighting PR's dynamic `import("shiki/bundle/web")`
    // as a literal bare specifier, which fails fast in the browser; the loader's
    // catch then falls back to `import(globalThis.__MORDN_SHIKI_URL__)` (a CDN
    // URL the embed sets at init). This keeps shiki's ~1–2 MB OUT of the bundle.
    // Both the bare package and the `/bundle/web` subpath are listed because
    // esbuild matches exact specifiers. (main has no shiki import yet; this is
    // inert until the highlighting branch merges, and harmless meanwhile.)
    external: ['shiki', 'shiki/bundle/web'],
    // The bundle references NODE_ENV (React's dev/prod branch). There is no
    // process in the browser, so inline the production value at build time —
    // this also drops React's dev-only warnings and dead code.
    define: {
      'process.env.NODE_ENV': '"production"',
      // Pin the CSS fallback <link> to the exact published version. Read from
      // package.json at config-eval time so it never drifts from the release.
      '__MORDN_WIDGET_VERSION__': JSON.stringify(pkg.version),
    },
  },
]);

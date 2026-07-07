import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { IngestSource } from '../server/knowledge';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase());
    });
  });
}

async function confirm(message: string): Promise<boolean> {
  const answer = await ask(`${message} (y/n): `);
  return answer === 'y' || answer === 'yes';
}

function detectAppDir(): string {
  if (fs.existsSync(path.join(process.cwd(), 'src', 'app'))) {
    return path.join(process.cwd(), 'src', 'app');
  }
  if (fs.existsSync(path.join(process.cwd(), 'app'))) {
    return path.join(process.cwd(), 'app');
  }
  return path.join(process.cwd(), 'src', 'app');
}

function detectLibDir(): string {
  if (fs.existsSync(path.join(process.cwd(), 'src'))) {
    return path.join(process.cwd(), 'src', 'lib');
  }
  return path.join(process.cwd(), 'lib');
}

async function writeFileWithConfirm(filePath: string, content: string): Promise<boolean> {
  if (fs.existsSync(filePath)) {
    const overwrite = await confirm(
      `File ${path.relative(process.cwd(), filePath)} already exists. Overwrite?`,
    );
    if (!overwrite) {
      console.log(`  Skipped: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${path.relative(process.cwd(), filePath)}`);
  return true;
}

// ============================================================================
// FILE TEMPLATES
//
// The scaffold is intentionally tiny. All the chat logic — auth gating,
// conversation ownership, idempotent persistence, streaming, history,
// attachment re-signing, upload policy — lives inside `createChatHandler`
// in the package. You own three things: who the user is (auth), which model,
// and which tools. That's it.
// ============================================================================

// The single catch-all route that mounts the entire backend. One file.
const CATCHALL_ROUTE = `import { createChatHandler } from '@mordn/chat-widget/server';
import { createDrizzleChatStore } from '@mordn/chat-widget/server/drizzle';
import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';
import { anthropic } from '@ai-sdk/anthropic';
import { getChatUserId } from '@/lib/chat-auth';

// Allow tool-using turns to stream beyond the default 30s.
export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  // REQUIRED: derive the user id from your SERVER session. See lib/chat-auth.ts.
  getUserId: getChatUserId,

  // Which model to stream from. Swap for your provider/model.
  model: anthropic('claude-sonnet-4-5'),

  // Persistence. The default Drizzle store uses DATABASE_URL. Replace with
  // your own ChatStore to bring your own database.
  store: createDrizzleChatStore(),

  // Attachments. The default uses a PRIVATE Supabase bucket + signed URLs.
  // Remove this line to disable uploads, or pass your own StorageAdapter.
  storage: createSupabaseStorage(),

  // A system prompt. Make it a function of ctx to personalise per user.
  buildSystemPrompt: () => 'You are a helpful assistant.',

  // Optional: cut tokens on large tool outputs / context with Headroom
  // (https://github.com/headroomlabs-ai/headroom). Run a Headroom service,
  // set HEADROOM_BASE_URL in your env, then flip this on. Safe by default —
  // if the service is unreachable the turn just proceeds uncompressed.
  // compression: true,

  // Add your tools here. buildTools is async and receives the request context
  // (userId, conversationId, request) so tools can be user-scoped. If a tool
  // holds a per-request resource (e.g. an MCP client), return a \`cleanup\`
  // and the handler will tear it down exactly once when the turn ends.
  //
  // buildTools: async (ctx) => ({ tools: { /* ... */ }, cleanup: async () => {} }),
});
`;

// The ONE thing the developer must implement. Throws until they do — so the
// scaffold is never silently insecure. This is the file that closes the
// IDOR-by-default hole: identity comes from the verified server session, never
// from a client-supplied header/query/body.
const CHAT_AUTH_STUB = `/**
 * Chat identity — the security boundary.
 *
 * Return the authenticated user's id derived from your SERVER session: a
 * verified cookie / JWT, Clerk \`auth()\`, NextAuth \`getServerSession()\`,
 * \`supabase.auth.getUser()\`, etc. Return \`null\` for an unauthenticated
 * request (the handler responds 401).
 *
 * SECURITY — read this once:
 *   • NEVER read the id from the request body, query string, or a header the
 *     browser controls (e.g. X-User-Id). Those are forgeable; trusting them
 *     lets any user read/write another user's conversations (IDOR).
 *   • The widget DOES send an X-User-Id header — ignore it for authorization.
 *     It is not, and must never be treated as, proof of identity.
 *
 * This stub throws on purpose. Replace its body with your real session lookup
 * before going to production.
 */
export async function getChatUserId(request: Request): Promise<string | null> {
  // ── Example (Clerk) ──────────────────────────────────────────────────────
  // import { auth } from '@clerk/nextjs/server';
  // const { userId } = await auth();
  // return userId;
  //
  // ── Example (NextAuth) ───────────────────────────────────────────────────
  // import { getServerSession } from 'next-auth';
  // const session = await getServerSession(authOptions);
  // return session?.user?.id ?? null;
  //
  // ── Example (Supabase Auth) ──────────────────────────────────────────────
  // const supabase = createServerClient(/* ... */);
  // const { data: { user } } = await supabase.auth.getUser();
  // return user?.id ?? null;

  void request;
  throw new Error(
    '[chat-widget] getChatUserId is not implemented. Derive the user id from ' +
      'your server session and return it (or null). See the examples in this ' +
      'file. Do NOT read the id from request headers/query/body.',
  );
}
`;

// drizzle-kit config pointing at the package's v2 (parts-first) schema.
const DRIZZLE_CONFIG = `import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // The default store's schema lives in the package. drizzle-kit reads it from
  // the built dist so it can generate/push migrations for the chat tables.
  schema: './node_modules/@mordn/chat-widget/dist/server/drizzle/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`;

const ENV_EXAMPLE = `# Database (required for the default Drizzle store)
DATABASE_URL="postgresql://postgres.xxx:[PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres"

# Attachments (required only if you keep createSupabaseStorage)
# The bucket MUST be created as a PRIVATE bucket.
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Knowledge base / RAG embeddings (required only if you use the knowledge module).
# The default embedder is Google Gemini "gemini-embedding-2" (1536-dim, REST).
# Get a key at https://aistudio.google.com/apikey
GEMINI_API_KEY="your-gemini-api-key"
# Or set GOOGLE_GENERATIVE_AI_API_KEY instead — both are accepted.

# Token compression (optional — https://github.com/headroomlabs-ai/headroom)
# Point the widget at a running Headroom service and set compression: true on
# createChatHandler to shrink large tool outputs, RAG chunks, and history.
# Unset = disabled (default). If unreachable, the turn proceeds uncompressed.
# HEADROOM_BASE_URL="http://localhost:8787"
# HEADROOM_API_KEY=""
`;

// ============================================================================
// INIT
// ============================================================================

async function init() {
  console.log('\n@mordn/chat-widget init\n');
  console.log(
    'Scaffolds a secure-by-default chat backend: one catch-all route + an\n' +
      'auth stub you implement. All chat logic lives in the package.\n',
  );

  const appDir = detectAppDir();
  const libDir = detectLibDir();
  console.log(`Detected app directory: ${path.relative(process.cwd(), appDir)}`);
  console.log(`Detected lib directory: ${path.relative(process.cwd(), libDir)}\n`);

  let filesCreated = 0;

  console.log('Creating files...');
  // The whole backend mounts on one catch-all route.
  if (
    await writeFileWithConfirm(
      path.join(appDir, 'api', 'chat', '[[...chat]]', 'route.ts'),
      CATCHALL_ROUTE,
    )
  ) {
    filesCreated++;
  }

  // The auth boundary — throws until implemented.
  if (await writeFileWithConfirm(path.join(libDir, 'chat-auth.ts'), CHAT_AUTH_STUB)) {
    filesCreated++;
  }

  if (
    await writeFileWithConfirm(path.join(process.cwd(), 'drizzle.config.ts'), DRIZZLE_CONFIG)
  ) {
    filesCreated++;
  }

  if (await writeFileWithConfirm(path.join(process.cwd(), '.env.example'), ENV_EXAMPLE)) {
    filesCreated++;
  }

  console.log(`\n✓ Created ${filesCreated} files\n`);

  console.log('Next steps:');
  console.log('  1. Install the required peer deps and an AI provider for your model:');
  console.log('       npm install @ai-sdk/react @ai-sdk/anthropic');
  console.log('     (@ai-sdk/react is a required peer dependency the widget renders with;');
  console.log('      swap @ai-sdk/anthropic for your provider, e.g. @ai-sdk/openai.)');
  console.log('  2. Copy .env.example to .env.local and fill in your credentials');
  console.log('  3. Implement getChatUserId() in lib/chat-auth.ts');
  console.log('     ⚠  Until you do, every chat request will throw — by design.');
  console.log('  4. Run: npx drizzle-kit push   (creates the chat tables)');
  console.log('  5. If using uploads: create a PRIVATE "chat-attachments" bucket in Supabase');
  console.log('  6. Mount the widget in your app:\n');
  console.log("     import { ChatWidget } from '@mordn/chat-widget';");
  console.log("     import '@mordn/chat-widget/styles.css';");
  console.log('     <ChatWidget userId={/* your user id */} />\n');
  console.log('Security: see SECURITY.md — userId is established on the server,');
  console.log('never trusted from the client.\n');

  rl.close();
}

// ============================================================================
// COMMAND ROUTER
//
// The bin supports the scaffold (`init`, default) plus knowledge-base ops:
//
//   chat-widget init                       scaffold the backend (default)
//   chat-widget ingest [--config p] ...    ingest sources into a namespace
//     [URL …]                                ad-hoc page URLs (.md/.mdx route as markdown)
//     [--llms <url> …]                       an llms.txt index (expands to its linked docs)
//   chat-widget sync   [--config p]        re-ingest the config's sources (idempotent)
//   chat-widget status [--config p]        show per-source chunk counts / status
//   chat-widget list   [--config p]        list sources in the namespace
//
// The knowledge commands import the user's config module (default
// `./chat-widget.config.{mjs,js,ts}`) which must default-export:
//   { store: KnowledgeStoreFactory, namespace: string, sources?: IngestSource[],
//     embedder?: Embedder, chunkSize?, overlap?, crawl? }
// `store` is the READ+WRITE factory (createKnowledgeDrizzleStore({ embedder })),
// so these commands run admin-side only — never in the chat request path.
// ============================================================================

const KNOWLEDGE_COMMANDS = new Set(['ingest', 'sync', 'status', 'list']);

function parseFlags(argv: string[]): { config?: string; llms: string[]; rest: string[] } {
  const rest: string[] = [];
  const llms: string[] = [];
  let config: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') {
      config = argv[++i];
    } else if (argv[i] === '--llms') {
      // Repeatable: --llms <url> [--llms <url> …]. Points at an llms.txt index.
      const v = argv[++i];
      if (v) llms.push(v);
    } else {
      rest.push(argv[i]);
    }
  }
  return { config, llms, rest };
}

async function loadKnowledgeConfig(configPath?: string): Promise<any> {
  const candidates = configPath
    ? [configPath]
    : ['chat-widget.config.mjs', 'chat-widget.config.js', 'chat-widget.config.cjs'];
  for (const rel of candidates) {
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    if (fs.existsSync(abs)) {
      const mod = await import(/* webpackIgnore: true */ abs);
      return mod.default ?? mod;
    }
  }
  throw new Error(
    `No config found (looked for ${candidates.join(', ')}). Create one that ` +
      'default-exports { store, namespace, sources, embedder } using ' +
      'createKnowledgeDrizzleStore({ embedder }) from ' +
      '@mordn/chat-widget/server/knowledge/drizzle. Pass --config <path> to override.',
  );
}

async function runKnowledge(command: string, argv: string[]): Promise<void> {
  const { config: configPath } = parseFlags(argv);
  const cfg = await loadKnowledgeConfig(configPath);
  if (!cfg.store || !cfg.namespace) {
    throw new Error('config must export { store, namespace } (and usually sources, embedder).');
  }
  // Defer the (heavy) ingest import so `init` never pays for it.
  const { ingest } = (await import('@mordn/chat-widget/server/knowledge')) as typeof import('../server/knowledge');
  const store = cfg.store(cfg.namespace);

  if (command === 'list' || command === 'status') {
    const sources = await store.listSources();
    if (sources.length === 0) {
      console.log(`(no sources in namespace "${cfg.namespace}")`);
      return;
    }
    console.log(`Sources in "${cfg.namespace}":`);
    for (const s of sources) {
      console.log(
        `  ${s.status.padEnd(7)} ${String(s.chunkCount).padStart(4)} chunks  ${s.source}` +
          (command === 'status' ? `  (updated ${s.updatedAt})` : ''),
      );
    }
    return;
  }

  // ingest / sync — both run the pipeline; sync is just ingest over the config's
  // sources (idempotent via contentHash). `ingest` may take explicit refs after
  // the command for ad-hoc URLs, and `--llms <url>` for llms.txt indexes. A
  // plain `.md`/`.mdx` URL needs no special flag — the loader detects markdown
  // by extension/content-type and routes it through the heading-aware chunker.
  const { llms, rest } = parseFlags(argv);
  const adhoc: IngestSource[] = [
    ...rest.filter((r) => /^https?:\/\//.test(r)).map((url) => ({ type: 'url' as const, url })),
    ...llms.map((url) => ({ type: 'llms' as const, url })),
  ];
  const sources: IngestSource[] = adhoc.length ? adhoc : (cfg.sources ?? []);
  if (sources.length === 0) {
    throw new Error(
      'Nothing to ingest: pass URLs (or --llms <url>) after the command, or set `sources` in the config.',
    );
  }

  console.log(`Ingesting ${sources.length} source(s) into "${cfg.namespace}"…`);
  const report = await ingest({
    store,
    namespace: cfg.namespace,
    sources,
    embedder: cfg.embedder,
    chunkSize: cfg.chunkSize,
    overlap: cfg.overlap,
    crawl: cfg.crawl,
    docsMode: cfg.docsMode,
    preferLlmsTxt: cfg.preferLlmsTxt,
    onProgress: (p) => {
      // Surface discovery/notice messages (e.g. "found llms.txt …") on their own
      // line so they aren't overwritten by the in-place progress counter.
      if (p.message && (p.stage === 'fetch' || p.stage === 'done')) {
        process.stdout.write(`\n  ${p.message}\n`);
      }
      process.stdout.write(`\r  [${p.stage}] ${p.done}/${p.total} ${p.source ?? ''}`.padEnd(72));
    },
  });
  process.stdout.write('\n');
  console.log(
    `Done: ${report.sources} processed, ${report.skipped} unchanged, ` +
      `${report.chunks} chunks upserted, ${report.deleted} orphans deleted ` +
      `in ${report.durationMs}ms.`,
  );
  if (report.errors.length) {
    console.log(`Errors (${report.errors.length}):`);
    for (const e of report.errors) console.log(`  ${e.source}: ${e.error}`);
  }
}

async function main() {
  const command = process.argv[2];
  if (command && KNOWLEDGE_COMMANDS.has(command)) {
    rl.close(); // no interactive prompts for KB commands
    await runKnowledge(command, process.argv.slice(3));
    return;
  }
  // Default (and explicit `init`): the scaffold.
  await init();
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  try {
    rl.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
});

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
  console.log('  1. Copy .env.example to .env.local and fill in your credentials');
  console.log('  2. Implement getChatUserId() in lib/chat-auth.ts');
  console.log('     ⚠  Until you do, every chat request will throw — by design.');
  console.log('  3. Run: npx drizzle-kit push   (creates the chat tables)');
  console.log('  4. If using uploads: create a PRIVATE "chat-attachments" bucket in Supabase');
  console.log('  5. Mount the widget in your app:\n');
  console.log("     import { ChatWidget } from '@mordn/chat-widget';");
  console.log("     import '@mordn/chat-widget/styles.css';");
  console.log('     <ChatWidget userId={/* your user id */} />\n');
  console.log('Security: see SECURITY.md — userId is established on the server,');
  console.log('never trusted from the client.\n');

  rl.close();
}

init().catch((error) => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});

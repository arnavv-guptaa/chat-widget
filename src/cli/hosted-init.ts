import * as fs from 'node:fs';
import * as path from 'node:path';

export type InitMode = 'hosted' | 'self-hosted';
export type AppDirectory = 'app' | 'src/app';
export interface ScaffoldFile { path: string; content: string }

/** Only init flags belong here; knowledge commands retain their own parser. */
export function parseInitArgs(args: readonly string[]): { mode: InitMode; help: boolean } {
  let mode: InitMode | undefined;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    const value = arg === '--hosted' ? 'hosted'
      : arg === '--mode' ? args[++i]
      : arg.startsWith('--mode=') ? arg.slice('--mode='.length)
      : undefined;
    if (value !== 'hosted' && value !== 'self-hosted') {
      throw new Error(`Unsupported init option: ${arg}. Use --hosted or --mode hosted|self-hosted.`);
    }
    if (mode && mode !== value) throw new Error('Conflicting init modes; choose only one.');
    mode = value;
  }
  return { mode: mode ?? 'self-hosted', help };
}

/** Pure, deterministic templates; no secrets, prompts, network, or shell commands. */
export function generateHostedFiles(appDir: AppDirectory): ScaffoldFile[] {
  if (appDir !== 'app' && appDir !== 'src/app') throw new Error('Unsupported App Router directory.');
  const routeDir = `${appDir}/api/chat/[[...chat]]`;
  return [
    {
      path: `${routeDir}/route.ts`,
      content: `import { createMordnHandler } from '@mordn/chat-widget/server';
import { getChatUserId } from './chat-auth';

// Inference and tools run in YOUR deployment, not in the mordn control plane.
export const runtime = 'nodejs';
export const maxDuration = 300;

const apiKey = process.env.MORDN_CHAT_KEY;
if (!apiKey) throw new Error('[chat-widget] Set MORDN_CHAT_KEY in your server environment.');

export const { GET, POST, DELETE, OPTIONS } = createMordnHandler({
  apiKey,
  getUserId: getChatUserId,
  // Published agent config supplies the model and prompt. Configure gateway
  // credentials in this server environment; MORDN_CHAT_KEY is NOT a model key.
  // Add your own model / buildTools here when you need code-level overrides.
});
`,
    },
    {
      path: `${routeDir}/chat-auth.ts`,
      content: `/**
 * REQUIRED: replace this fail-closed stub with your verified SERVER session.
 * Return a stable user id only after verifying the session (Clerk auth(),
 * Auth.js auth(), or your existing session verifier); otherwise return null.
 * Never trust a browser-controlled header, query parameter, or request body
 * as identity. Do not substitute a constant demo user or anonymous fallback.
 * Until implemented, protected chat requests are rejected with 401.
 */
export async function getChatUserId(request: Request): Promise<string | null> {
  void request;
  return null;
}
`,
    },
    {
      path: `${appDir}/mordn-chat.tsx`,
      content: `'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

// Import and render <MordnChat /> in your existing layout or page manually.
// The default same-origin /api/chat route uses your server-verified session.
// Never pass a server key or a browser-asserted user id to the widget.
export function MordnChat() {
  return <ChatWidget />;
}
`,
    },
    {
      path: '.env.mordn.example',
      content: `# Reference only. Manually add these to your server environment / secret manager.
# Do not overwrite an existing .env.local. Never use NEXT_PUBLIC_ for secrets.
# Create and publish an agent at https://mordn.com, then copy its SERVER key.
MORDN_CHAT_KEY=""

# Inference runs in your deployment. For the default AI SDK gateway model,
# configure gateway authentication (e.g. a gateway key, or supported deployment
# authentication). MORDN_CHAT_KEY does not authenticate model calls.
AI_GATEWAY_API_KEY=""

# Also configure the server-side session verifier used in chat-auth.ts.
# If you override the model/provider, configure that provider's server secrets.
`,
    },
  ];
}

function lstat(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Refuse existing targets, symlinks (including dangling ones), and non-directory parents. */
export function assertNewFile(root: string, relativePath: string): void {
  const base = path.resolve(root);
  const target = path.resolve(base, relativePath);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside project: ${relativePath}`);
  }
  let current = base;
  // Validate the project root itself too; never write through a symlink root.
  const baseStat = lstat(base);
  if (!baseStat?.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error('Project root must be an existing, non-symlink directory.');
  }
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = lstat(current);
    if (!stat) continue;
    if (i === parts.length - 1 || stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing existing or unsafe path: ${path.relative(base, current)}`);
    }
  }
}

/** Exclusive create is the final protection against a target appearing after preflight. */
export function createNewFile(root: string, file: ScaffoldFile): void {
  assertNewFile(root, file.path);
  const target = path.resolve(root, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content, { flag: 'wx' });
}

export function scaffoldHosted(root: string): { appDir: AppDirectory; files: ScaffoldFile[] } {
  const appDirs = (['src/app', 'app'] as const).filter((dir) => lstat(path.join(root, dir)));
  if (appDirs.length !== 1) {
    throw new Error('Hosted init requires exactly one existing Next.js App Router directory: app/ or src/app/. No files created.');
  }
  const appDir = appDirs[0];
  const files = generateHostedFiles(appDir);
  // An existing chat subtree may contain route.js, [action], or other competing
  // handlers. Never mix an old backend/auth boundary with a newly generated one.
  if (lstat(path.join(root, appDir, 'api/chat'))) {
    throw new Error(`Refusing existing ${appDir}/api/chat. Merge the hosted quickstart manually. No files created.`);
  }
  for (const extension of ['ts', 'tsx', 'js', 'jsx']) {
    assertNewFile(root, `${appDir}/mordn-chat.${extension}`);
  }
  // Check EVERY target before any write, so ordinary conflicts are all-or-nothing.
  for (const file of files) assertNewFile(root, file.path);
  for (const file of files) createNewFile(root, file);
  return { appDir, files };
}

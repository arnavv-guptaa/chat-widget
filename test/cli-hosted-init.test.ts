import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNewFile, createNewFile, generateHostedFiles, parseInitArgs, scaffoldHosted } from '../src/cli/hosted-init';

const temporaryDirectories: string[] = [];
function project(appDir?: 'app' | 'src/app'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mordn-cli-'));
  temporaryDirectories.push(root);
  if (appDir) fs.mkdirSync(path.join(root, appDir), { recursive: true });
  return root;
}
function seed(root: string, relative: string, content = 'existing content'): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}
// Cleanup is confined to test-owned mkdtemp directories, never user projects.
afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('init mode parser', () => {
  it('preserves the legacy default', () => {
    expect(parseInitArgs([])).toEqual({ mode: 'self-hosted', help: false });
    expect(parseInitArgs(['--mode', 'self-hosted']).mode).toBe('self-hosted');
  });
  it.each([['--hosted'], ['--mode', 'hosted'], ['--mode=hosted'], ['--hosted', '--mode', 'hosted']])(
    'supports explicit hosted flags: %j', (...args) => {
      expect(parseInitArgs(args)).toEqual({ mode: 'hosted', help: false });
    },
  );
  it.each([['--mode'], ['--mode='], ['--mode', 'unknown'], ['--force'], ['initt'], ['--hosted', '--mode', 'self-hosted'], ['--mode', 'hosted; touch /tmp/injected']])(
    'rejects invalid or conflicting arguments before writing: %j', (...args) => {
      expect(() => parseInitArgs(args)).toThrow();
    },
  );
  it('supports help without changing the mode', () => {
    expect(parseInitArgs(['--hosted', '--help'])).toEqual({ mode: 'hosted', help: true });
    expect(parseInitArgs(['-h']).help).toBe(true);
  });
});

describe('pure hosted templates', () => {
  it.each(['app', 'src/app'] as const)('generates deterministic, alias-independent own-runtime files for %s', (appDir) => {
    const files = generateHostedFiles(appDir);
    expect(files).toEqual(generateHostedFiles(appDir));
    expect(files.map((file) => file.path)).toEqual([
      `${appDir}/api/chat/[[...chat]]/route.ts`,
      `${appDir}/api/chat/[[...chat]]/chat-auth.ts`,
      `${appDir}/mordn-chat.tsx`,
      '.env.mordn.example',
    ]);
    const [route, auth, client, env] = files.map((file) => file.content);
    expect(route).toContain("import { createMordnHandler } from '@mordn/chat-widget/server'");
    expect(route).toContain("import { getChatUserId } from './chat-auth'");
    expect(route).toContain('export const { GET, POST, DELETE, OPTIONS }');
    expect(route).toContain("export const runtime = 'nodejs'");
    expect(route).toContain('process.env.MORDN_CHAT_KEY');
    expect(route).toContain('if (!apiKey) throw new Error(');
    expect(auth).toContain('return null;');
    expect(auth).not.toMatch(/return\s+['"`]/);
    expect(auth).not.toMatch(/request\.(headers|json|url)/);
    expect(client).toContain("'use client'");
    expect(client).toContain("import '@mordn/chat-widget/styles.css'");
    expect(client).toContain('return <ChatWidget />;');
    expect(client).not.toMatch(/process\.env|publishableKey|getUserToken|userId=|apiKey=/);
    expect(env).toContain('MORDN_CHAT_KEY=""');
    expect(env).toContain('AI_GATEWAY_API_KEY=""');
    expect(files.map((file) => file.content).join('\n')).not.toMatch(/createChatHandler|[Dd]rizzle|[Ss]upabase|DATABASE_URL|db push|drizzle-kit|@ai-sdk\/anthropic/);
  });
});

describe('hosted scaffold filesystem safety', () => {
  it.each(['app', 'src/app'] as const)('writes only four new files under %s, preserving pages and secrets', (appDir) => {
    const root = project(appDir);
    seed(root, `${appDir}/layout.tsx`, 'user layout');
    seed(root, `${appDir}/page.tsx`, 'user page');
    seed(root, '.env.local', 'MORDN_CHAT_KEY=keep-secret');
    seed(root, '.env.example', 'other env example');
    seed(root, 'drizzle.config.ts', 'existing database config');
    const { files } = scaffoldHosted(root);
    for (const file of files) expect(fs.readFileSync(path.join(root, file.path), 'utf8')).toBe(file.content);
    expect(fs.readFileSync(path.join(root, `${appDir}/layout.tsx`), 'utf8')).toBe('user layout');
    expect(fs.readFileSync(path.join(root, `${appDir}/page.tsx`), 'utf8')).toBe('user page');
    expect(fs.readFileSync(path.join(root, '.env.local'), 'utf8')).toBe('MORDN_CHAT_KEY=keep-secret');
    expect(fs.readFileSync(path.join(root, '.env.example'), 'utf8')).toBe('other env example');
    expect(fs.readFileSync(path.join(root, 'drizzle.config.ts'), 'utf8')).toBe('existing database config');
  });
  it('refuses reruns without changing generated content', () => {
    const root = project('app');
    const { files } = scaffoldHosted(root);
    seed(root, files[0].path, 'developer edits');
    expect(() => scaffoldHosted(root)).toThrow(/Refusing existing app\/api\/chat/);
    expect(fs.readFileSync(path.join(root, files[0].path), 'utf8')).toBe('developer edits');
  });
  it.each(['app/api/chat/route.js', 'app/api/chat/[action]/route.ts', 'app/api/chat/[[...chat]]/chat-auth.ts', 'app/mordn-chat.tsx', 'app/mordn-chat.jsx', '.env.mordn.example'])(
    'preflights conflict %s before creating any files', (conflict) => {
      const root = project('app');
      seed(root, conflict, 'do not replace');
      expect(() => scaffoldHosted(root)).toThrow(/Refusing/);
      expect(fs.readFileSync(path.join(root, conflict), 'utf8')).toBe('do not replace');
      for (const file of generateHostedFiles('app')) {
        if (file.path !== conflict) expect(fs.existsSync(path.join(root, file.path))).toBe(false);
      }
    },
  );
  it('refuses missing or ambiguous App Router roots without creating files', () => {
    const root = project();
    expect(() => scaffoldHosted(root)).toThrow(/exactly one/);
    expect(fs.readdirSync(root)).toEqual([]);
    fs.mkdirSync(path.join(root, 'app'));
    fs.mkdirSync(path.join(root, 'src/app'), { recursive: true });
    expect(() => scaffoldHosted(root)).toThrow(/exactly one/);
    expect(fs.existsSync(path.join(root, '.env.mordn.example'))).toBe(false);
  });
  it('refuses a regular file where a directory should be', () => {
    const root = project('app');
    seed(root, 'app/api');
    expect(() => scaffoldHosted(root)).toThrow();
    expect(fs.existsSync(path.join(root, '.env.mordn.example'))).toBe(false);
  });
  it.each(['app', 'app/api', 'app/api/chat', 'app/mordn-chat.tsx', '.env.mordn.example'])(
    'refuses symlink path %s and does not touch its target', (relative) => {
      const root = project();
      const outside = project();
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      if (!relative.startsWith('app')) fs.mkdirSync(path.join(root, 'app'));
      fs.symlinkSync(outside, path.join(root, relative), 'dir');
      expect(() => scaffoldHosted(root)).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    },
  );
  it('refuses dangling symlink targets and project root symlinks', () => {
    const root = project('app');
    fs.symlinkSync(path.join(root, 'missing'), path.join(root, '.env.mordn.example'));
    expect(() => scaffoldHosted(root)).toThrow(/Refusing/);
    expect(fs.existsSync(path.join(root, 'app/api'))).toBe(false);
    const parent = project();
    fs.symlinkSync(root, path.join(parent, 'linked'), 'dir');
    expect(() => assertNewFile(path.join(parent, 'linked'), 'new.ts')).toThrow(/Project root/);
  });
  it('exclusive file creation also protects the legacy scaffold and path traversal', () => {
    const root = project();
    createNewFile(root, { path: 'lib/auth.ts', content: 'original' });
    expect(() => createNewFile(root, { path: 'lib/auth.ts', content: 'replacement' })).toThrow(/Refusing/);
    expect(fs.readFileSync(path.join(root, 'lib/auth.ts'), 'utf8')).toBe('original');
    expect(() => createNewFile(root, { path: '../outside.ts', content: 'escape' })).toThrow(/outside project/);
  });
  it('treats shell metacharacters in project directories as literal paths', () => {
    const parent = project();
    const root = path.join(parent, 'project ; $(not-a-command)');
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    expect(scaffoldHosted(root).files).toHaveLength(4);
    expect(fs.readdirSync(parent)).toEqual(['project ; $(not-a-command)']);
  });
});

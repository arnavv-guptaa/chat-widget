// Dependency-free smoke of the shipped CLI, not the source template helpers.
// After the existing build: node scripts/assert-hosted-cli.mjs (from any cwd).
// Only runs Node + hosted init/help; never installs packages, imports generated
// routes, starts a server, or calls models/databases. No real secrets are needed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli/init.js', import.meta.url));
assert.ok(lstatSync(cli, { throwIfNoEntry: false })?.isFile(),
  'Missing built dist/cli/init.js; run the normal build before this assertion.');

// Only this invocation's mkdtemp tree is ever recursively removed.
const root = mkdtempSync(join(tmpdir(), 'mordn-hosted-cli-'));
const secret = 'test-only-preserve-this-value';

function seed(project, relative, content) {
  const target = join(project, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function snapshot(project, relative = '') {
  const entries = [];
  for (const name of readdirSync(join(project, relative)).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(join(project, path));
    assert.ok(!stat.isSymbolicLink(), `Unexpected symlink: ${path}`);
    if (stat.isDirectory()) {
      entries.push([`${path}/`, null], ...snapshot(project, path));
    } else {
      assert.ok(stat.isFile(), `Unexpected non-file: ${path}`);
      entries.push([path, readFileSync(join(project, path)).toString('base64')]);
    }
  }
  return entries;
}

function run(project, args, expectedStatus) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    // Do not inherit server/model/database credentials or NODE_OPTIONS hooks.
    // An empty PATH also keeps accidental package-manager lookup from working.
    env: {
      PATH: '',
      HOME: project,
      USERPROFILE: project,
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    shell: false,
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'CLI must exit normally, not time out');
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, new RegExp(secret), 'CLI must not print existing env secrets');
  assert.equal(result.status, expectedStatus,
    `Unexpected exit for ${args.join(' ')}:\n${output}`);
  return output;
}

try {
  for (const [appDir, args] of [
    ['app', ['init', '--hosted']],
    ['src/app', ['init', '--mode', 'hosted']],
  ]) {
    const project = join(root, appDir === 'app' ? 'root-app' : 'src-app');
    const routeDir = `${appDir}/api/chat/[[...chat]]`;
    const expected = [
      `${routeDir}/route.ts`, `${routeDir}/chat-auth.ts`,
      `${appDir}/mordn-chat.tsx`, '.env.mordn.example',
    ];
    const preserved = {
      [`${appDir}/layout.tsx`]: '// existing layout\n',
      [`${appDir}/page.tsx`]: '// existing page\n',
      '.env.local': `MORDN_CHAT_KEY=${secret}\nDATABASE_URL=do-not-connect\n`,
      '.env.example': '# existing application settings\n',
      'package.json': '{"name":"hosted-cli-smoke","private":true}\n',
      'drizzle.config.ts': '// existing database config; do not execute\n',
    };
    for (const [path, content] of Object.entries(preserved)) seed(project, path, content);

    // Help must be safe even in an otherwise valid project (no scaffold writes).
    const beforeHelp = snapshot(project);
    for (const helpArgs of [['--help'], [...args, '--help']]) {
      const help = run(project, helpArgs, 0);
      assert.match(help, /Usage: chat-widget/);
      assert.match(help, /--hosted/);
      assert.match(help, /--mode hosted\|self-hosted/);
      assert.deepEqual(snapshot(project), beforeHelp, 'Help must not change the project');
    }

    const created = run(project, args, 0);
    assert.match(created, /Required next steps/);
    for (const path of expected) assert.ok(created.includes(`Created: ${path}`), `Missing creation report: ${path}`);
    assert.deepEqual(snapshot(project).filter(([path]) => !path.endsWith('/')).map(([path]) => path).sort(),
      [...Object.keys(preserved), ...expected].sort(), 'Only the four hosted files should be created');
    for (const [path, content] of Object.entries(preserved)) {
      assert.equal(readFileSync(join(project, path), 'utf8'), content, `Overwrote ${path}`);
    }

    const [route, auth, client, env] = expected.map((path) => readFileSync(join(project, path), 'utf8'));
    assert.match(route, /import \{ createMordnHandler \} from '@mordn\/chat-widget\/server'/);
    assert.match(route, /import \{ getChatUserId \} from '\.\/chat-auth'/);
    assert.match(route, /export const runtime = 'nodejs'/);
    assert.match(route, /process\.env\.MORDN_CHAT_KEY/);
    assert.match(route, /if \(!apiKey\) throw new Error\(/);
    assert.match(route, /export const \{ GET, POST, DELETE, OPTIONS \} = createMordnHandler\(/);
    assert.match(route, /getUserId: getChatUserId/);
    // Assert the entire stub body, not just a comment mentioning return null.
    assert.match(auth, /export async function getChatUserId\(request: Request\): Promise<string \| null> \{\s*void request;\s*return null;\s*\}/);
    assert.match(auth, /verified SERVER session/);
    assert.match(auth, /rejected with 401/);
    assert.doesNotMatch(auth, /request\.(headers|json|url)|return\s+['"`]/);
    assert.match(client, /'use client'/);
    assert.match(client, /import '@mordn\/chat-widget\/styles\.css'/);
    assert.match(client, /return <ChatWidget \/>;/);
    assert.doesNotMatch(client, /process\.env|publishableKey|getUserToken|userId=|apiKey=/);
    assert.match(env, /^MORDN_CHAT_KEY=""$/m);
    assert.match(env, /^AI_GATEWAY_API_KEY=""$/m);
    assert.doesNotMatch([route, auth, client, env].join('\n'),
      /createChatHandler|[Dd]rizzle|[Ss]upabase|DATABASE_URL|drizzle-kit|@ai-sdk\/anthropic/);

    // A rerun must fail, preserving even developer edits byte-for-byte.
    seed(project, expected[0], `${route}\n// developer edit: preserve on rerun\n`);
    const beforeConflict = snapshot(project);
    const conflict = run(project, args, 1);
    assert.ok(conflict.includes(`Refusing existing ${appDir}/api/chat`), conflict);
    assert.deepEqual(snapshot(project), beforeConflict, 'Conflicting rerun changed files or directories');
    console.log(`Built hosted CLI passed: ${appDir} (help, create, templates, preserved secrets, rerun refusal).`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

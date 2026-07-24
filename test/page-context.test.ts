// Runtime harness for `context: 'auto'` page capture (#239, review round 1).
//
// Runnable with PLAIN NODE via type-stripping — no test runner, no deps:
//
//   node --experimental-strip-types test/page-context.test.ts
//
// (Node ≥ 22.6 for --experimental-strip-types; Node ≥ 23.6 strips by default.)
// It provides its own tiny describe/it/expect over `node:assert/strict`, runs
// on import, prints a pass/fail count, and exits non-zero if anything fails —
// so it doubles as a CI-friendly smoke of the capture defaults and the union
// resolver without pulling in vitest.
//
// What must hold:
//   1. The DEFAULT capture is safe: `url` = origin+pathname only (NO query,
//      NO fragment); a fragment is kept ONLY when it's a plain docs anchor;
//      token-/router-state fragments and the query string are dropped.
//   2. `includeQuery` / `includeHash` are the explicit opt-ins for more.
//   3. Capture is SSR-safe (returns {} with no window/document) and carries no
//      identity data.
//   4. The union resolver collapses object | 'auto' | function at send time,
//      degrading — never throwing — on a bad function, and 'auto' ALWAYS uses
//      the safe defaults.

import assert from 'node:assert/strict';
import {
  buildAutoPageContext,
  isSafeAnchorHash,
  resolveChatContext,
} from '../src/utils/page-context.ts';

// ---------------------------------------------------------------------------
// Minimal test harness (no external deps).
//
// Tests are COLLECTED into an ordered queue and executed strictly sequentially
// at the end (see the runner call). Sequential execution matters: the browser
// mocks install/restore globals, so overlapping async tests would race on
// `globalThis.window`. Each test — sync or async — fully completes (install →
// assert → restore) before the next begins.
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];
let currentSuite = '';

interface QueuedTest {
  full: string;
  fn: () => void | Promise<void>;
}
const queue: QueuedTest[] = [];

function describe(name: string, fn: () => void): void {
  const prev = currentSuite;
  currentSuite = name;
  fn(); // synchronously enqueues this suite's `it`s
  currentSuite = prev;
}

function it(label: string, fn: () => void | Promise<void>): void {
  const full = currentSuite ? `${currentSuite} › ${label}` : label;
  queue.push({ full, fn });
}

async function runQueue(): Promise<void> {
  for (const t of queue) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok   ${t.full}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${t.full}\n      ${msg.replace(/\n/g, '\n      ')}`);
      console.log(`  FAIL ${t.full}`);
    }
  }
}

// A tiny expect over node:assert so the assertions read like the old vitest
// suite (deepEqual / equal / ok).
function expect<T>(actual: T) {
  return {
    toEqual(expected: unknown): void {
      assert.deepEqual(actual, expected);
    },
    toBe(expected: unknown): void {
      assert.equal(actual, expected);
    },
    toBeUndefined(): void {
      assert.equal(actual, undefined);
    },
    toBeTruthy(): void {
      assert.ok(actual);
    },
    toBeFalsy(): void {
      assert.ok(!actual);
    },
  };
}

// ---------------------------------------------------------------------------
// Browser mocking. We install fakes on globalThis and always tear them down so
// tests don't leak globals into each other. `origin` + `search` are modelled so
// the safe-default (origin+pathname, no query) path is exercised faithfully.
// ---------------------------------------------------------------------------
interface BrowserOpts {
  origin?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  title?: string;
}

function installBrowser(opts: BrowserOpts): () => void {
  const g = globalThis as Record<string, unknown>;
  const priorWindow = g.window;
  const priorDocument = g.document;
  g.window = {
    location: {
      origin: opts.origin,
      pathname: opts.pathname,
      search: opts.search,
      hash: opts.hash,
    },
  };
  g.document = { title: opts.title };
  return () => {
    if (priorWindow === undefined) delete g.window;
    else g.window = priorWindow;
    if (priorDocument === undefined) delete g.document;
    else g.document = priorDocument;
  };
}

function withBrowser(opts: BrowserOpts, fn: () => void): void {
  const restore = installBrowser(opts);
  try {
    fn();
  } finally {
    restore();
  }
}

async function withBrowserAsync(
  opts: BrowserOpts,
  fn: () => Promise<void>,
): Promise<void> {
  const restore = installBrowser(opts);
  try {
    await fn();
  } finally {
    restore();
  }
}

// A representative "dangerous" URL: reset token in the query AND an OAuth
// implicit-flow fragment. The safe default must ship neither.
const DANGEROUS = {
  origin: 'https://app.example.com',
  pathname: '/docs/install',
  search: '?token=abc&next=/dashboard',
  hash: '#access_token=xyz&state=123',
  title: 'Install',
};

// ===========================================================================
// isSafeAnchorHash — the heuristic in isolation.
// ===========================================================================
describe('isSafeAnchorHash — conservative anchor heuristic', () => {
  it('accepts a plain docs anchor', () => {
    expect(isSafeAnchorHash('#installation')).toBeTruthy();
    expect(isSafeAnchorHash('#step-2.1')).toBeTruthy();
    expect(isSafeAnchorHash('#a')).toBeTruthy();
    expect(isSafeAnchorHash('#section_3:sub')).toBeTruthy();
  });

  it('rejects empty / bare "#"', () => {
    expect(isSafeAnchorHash('')).toBeFalsy();
    expect(isSafeAnchorHash('#')).toBeFalsy();
  });

  it('rejects token/query-shaped fragments (= & ?)', () => {
    expect(isSafeAnchorHash('#access_token=xyz&state=123')).toBeFalsy();
    expect(isSafeAnchorHash('#a=b')).toBeFalsy();
    expect(isSafeAnchorHash('#q?x')).toBeFalsy();
  });

  it('rejects hash-router / deep-link paths (/)', () => {
    expect(isSafeAnchorHash('#/app/users/42')).toBeFalsy();
    expect(isSafeAnchorHash('#/settings')).toBeFalsy();
  });

  it('rejects a leading non-alphanumeric', () => {
    expect(isSafeAnchorHash('#-leading-dash')).toBeFalsy();
    expect(isSafeAnchorHash('#.dot')).toBeFalsy();
  });

  it('rejects characters outside the anchor alphabet', () => {
    expect(isSafeAnchorHash('#has space')).toBeFalsy();
    expect(isSafeAnchorHash('#pct%20')).toBeFalsy();
    expect(isSafeAnchorHash('#emoji\u{1F600}')).toBeFalsy();
  });

  it('rejects an over-long fragment (max body 129: first char + {0,128})', () => {
    // The regex is `#[alnum][alnum...]{0,128}` → the fragment body may be at
    // most 1 + 128 = 129 chars after the `#`. 129 is the boundary (allowed),
    // 130 is over the limit (rejected).
    const atLimit = '#' + 'a'.repeat(129); // 129 chars after # → allowed
    const overLimit = '#' + 'a'.repeat(130); // 130 → rejected
    expect(isSafeAnchorHash(atLimit)).toBeTruthy();
    expect(isSafeAnchorHash(overLimit)).toBeFalsy();
  });
});

// ===========================================================================
// buildAutoPageContext — safe default capture.
// ===========================================================================
describe('buildAutoPageContext — safe default capture', () => {
  it('returns {} server-side (no window/document)', () => {
    // Default node env: neither global exists — must not throw, must be empty.
    expect(buildAutoPageContext()).toEqual({});
  });

  it('url = origin + pathname; query string is STRIPPED by default', () => {
    withBrowser(DANGEROUS, () => {
      const ctx = buildAutoPageContext();
      // The whole point of the review fix: no ?token=... in the url, no query
      // field, and the OAuth fragment dropped.
      expect(ctx).toEqual({
        url: 'https://app.example.com/docs/install',
        path: '/docs/install',
        title: 'Install',
      });
    });
  });

  it('omits a token-bearing fragment', () => {
    withBrowser(
      {
        origin: 'https://d.example.com',
        pathname: '/p',
        search: '',
        hash: '#access_token=xyz&state=123',
        title: 'P',
      },
      () => {
        const ctx = buildAutoPageContext();
        expect('hash' in ctx).toBeFalsy();
        expect(ctx).toEqual({ url: 'https://d.example.com/p', path: '/p', title: 'P' });
      },
    );
  });

  it('keeps a plain docs anchor', () => {
    withBrowser(
      {
        origin: 'https://docs.example.com',
        pathname: '/guide/start',
        search: '?q=1',
        hash: '#install',
        title: 'Getting started',
      },
      () => {
        const ctx = buildAutoPageContext();
        // anchor kept; query still stripped.
        expect(ctx).toEqual({
          url: 'https://docs.example.com/guide/start',
          path: '/guide/start',
          hash: '#install',
          title: 'Getting started',
        });
      },
    );
  });

  it('drops a hash-router-state fragment (contains /)', () => {
    withBrowser(
      { origin: 'https://d', pathname: '/', search: '', hash: '#/app/users/42', title: 'X' },
      () => {
        const ctx = buildAutoPageContext();
        expect('hash' in ctx).toBeFalsy();
      },
    );
  });

  it('drops an over-long fragment via the heuristic', () => {
    withBrowser(
      {
        origin: 'https://d',
        pathname: '/',
        search: '',
        hash: '#' + 'a'.repeat(200),
        title: 'X',
      },
      () => {
        expect('hash' in buildAutoPageContext()).toBeFalsy();
      },
    );
  });

  it('omits empty hash, empty search, and empty title (minimal shape)', () => {
    withBrowser(
      { origin: 'https://docs.example.com', pathname: '/', search: '', hash: '', title: '' },
      () => {
        expect(buildAutoPageContext()).toEqual({
          url: 'https://docs.example.com/',
          path: '/',
        });
      },
    );
  });

  it('captures no identity fields (no cookies / referrer / user agent)', () => {
    withBrowser(
      { origin: 'https://docs.example.com', pathname: '/x', search: '', title: 'X' },
      () => {
        const ctx = buildAutoPageContext();
        expect(Object.keys(ctx).sort()).toEqual(['path', 'title', 'url']);
      },
    );
  });
});

// ===========================================================================
// buildAutoPageContext — explicit opt-ins.
// ===========================================================================
describe('buildAutoPageContext — explicit opt-ins', () => {
  it('includeQuery appends the query to url AND adds a query field', () => {
    withBrowser(DANGEROUS, () => {
      const ctx = buildAutoPageContext({ includeQuery: true });
      expect(ctx.url).toBe('https://app.example.com/docs/install?token=abc&next=/dashboard');
      expect(ctx.query).toBe('?token=abc&next=/dashboard');
      // includeHash NOT set → the OAuth fragment is still dropped.
      expect('hash' in ctx).toBeFalsy();
    });
  });

  it('includeQuery with no query string adds no query field', () => {
    withBrowser(
      { origin: 'https://d', pathname: '/p', search: '', hash: '', title: '' },
      () => {
        const ctx = buildAutoPageContext({ includeQuery: true });
        expect(ctx).toEqual({ url: 'https://d/p', path: '/p' });
      },
    );
  });

  it('includeHash bypasses the heuristic and keeps a token fragment', () => {
    withBrowser(DANGEROUS, () => {
      const ctx = buildAutoPageContext({ includeHash: true });
      expect(ctx.hash).toBe('#access_token=xyz&state=123');
      // includeQuery NOT set → query still stripped.
      expect('query' in ctx).toBeFalsy();
      expect(ctx.url).toBe('https://app.example.com/docs/install');
    });
  });

  it('includeHash still omits an empty / bare-"#" fragment (just noise)', () => {
    withBrowser(
      { origin: 'https://d', pathname: '/p', search: '', hash: '#', title: '' },
      () => {
        expect('hash' in buildAutoPageContext({ includeHash: true })).toBeFalsy();
      },
    );
  });

  it('both opt-ins together capture the full url + query + raw fragment', () => {
    withBrowser(DANGEROUS, () => {
      const ctx = buildAutoPageContext({ includeQuery: true, includeHash: true });
      expect(ctx).toEqual({
        url: 'https://app.example.com/docs/install?token=abc&next=/dashboard',
        path: '/docs/install',
        query: '?token=abc&next=/dashboard',
        hash: '#access_token=xyz&state=123',
        title: 'Install',
      });
    });
  });
});

// ===========================================================================
// resolveChatContext — union resolution at send time.
// ===========================================================================
describe('resolveChatContext — union resolution at send time', () => {
  it('passes undefined through as undefined (serialises away)', async () => {
    expect(await resolveChatContext(undefined)).toBeUndefined();
  });

  it('passes a plain object through unchanged', async () => {
    const obj = { route: '/billing', plan: 'pro' };
    expect(await resolveChatContext(obj)).toBe(obj);
  });

  it("resolves 'auto' via buildAutoPageContext with SAFE defaults (query stripped)", async () => {
    await withBrowserAsync(DANGEROUS, async () => {
      // The string literal must NEVER include the query or the token fragment.
      expect(await resolveChatContext('auto')).toEqual({
        url: 'https://app.example.com/docs/install',
        path: '/docs/install',
        title: 'Install',
      });
    });
  });

  it("resolves 'auto' to {} server-side", async () => {
    expect(await resolveChatContext('auto')).toEqual({});
  });

  it('function form can opt into richer capture (includeQuery)', async () => {
    await withBrowserAsync(DANGEROUS, async () => {
      const resolved = await resolveChatContext(() =>
        buildAutoPageContext({ includeQuery: true }),
      );
      expect(resolved).toEqual({
        url: 'https://app.example.com/docs/install?token=abc&next=/dashboard',
        path: '/docs/install',
        query: '?token=abc&next=/dashboard',
        title: 'Install',
      });
    });
  });

  it('calls a sync function form', async () => {
    expect(await resolveChatContext(() => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it('awaits an async function form', async () => {
    expect(await resolveChatContext(async () => ({ b: 2 }))).toEqual({ b: 2 });
  });

  it('degrades a throwing function to {} and warns (once)', async () => {
    const orig = console.warn;
    let warnCount = 0;
    console.warn = () => {
      warnCount++;
    };
    try {
      const boom = () => {
        throw new Error('nope');
      };
      expect(await resolveChatContext(boom)).toEqual({});
      expect(
        await resolveChatContext(async () => Promise.reject(new Error('nope2'))),
      ).toEqual({});
      expect(warnCount).toBe(1);
    } finally {
      console.warn = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Run the collected tests sequentially, then report and set the exit code.
// ---------------------------------------------------------------------------
await runQueue();

console.log('');
console.log(`page-context harness: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}

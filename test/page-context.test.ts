import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAutoPageContext, resolveChatContext } from '../src/utils/page-context';

// `context: 'auto'` captures the page location for the model. Two things must
// hold: the capture is SSR-safe (no window/document access outside guards, so
// it returns {} server-side) and captures ONLY location fields (no identity
// data). And the union resolver (object | 'auto' | function) must collapse to a
// concrete object at send time, degrading — never throwing — on a bad function.

// vitest runs in a `node` environment, so `window`/`document` are undefined by
// default (the SSR case). We install fakes to exercise the browser path and
// always tear them down so tests don't leak globals into each other.
function withBrowser(
  opts: { href?: string; pathname?: string; hash?: string; title?: string },
  fn: () => void,
): void {
  const g = globalThis as Record<string, unknown>;
  const priorWindow = g.window;
  const priorDocument = g.document;
  g.window = { location: { href: opts.href, pathname: opts.pathname, hash: opts.hash } };
  g.document = { title: opts.title };
  try {
    fn();
  } finally {
    if (priorWindow === undefined) delete g.window;
    else g.window = priorWindow;
    if (priorDocument === undefined) delete g.document;
    else g.document = priorDocument;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildAutoPageContext — page capture', () => {
  it('returns {} server-side (no window/document)', () => {
    // Default node env: neither global exists — must not throw, must be empty.
    expect(buildAutoPageContext()).toEqual({});
  });

  it('captures url/path/title/hash from the browser', () => {
    withBrowser(
      {
        href: 'https://docs.example.com/guide/start?q=1#install',
        pathname: '/guide/start',
        hash: '#install',
        title: 'Getting started',
      },
      () => {
        expect(buildAutoPageContext()).toEqual({
          url: 'https://docs.example.com/guide/start?q=1#install',
          path: '/guide/start',
          hash: '#install',
          title: 'Getting started',
        });
      },
    );
  });

  it('omits empty hash and empty title (minimal shape)', () => {
    withBrowser(
      { href: 'https://docs.example.com/', pathname: '/', hash: '', title: '' },
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
      { href: 'https://docs.example.com/x', pathname: '/x', title: 'X' },
      () => {
        const ctx = buildAutoPageContext();
        expect(Object.keys(ctx).sort()).toEqual(['path', 'title', 'url']);
      },
    );
  });
});

describe('resolveChatContext — union resolution at send time', () => {
  it('passes undefined through as undefined (serialises away)', async () => {
    expect(await resolveChatContext(undefined)).toBeUndefined();
  });

  it('passes a plain object through unchanged', async () => {
    const obj = { route: '/billing', plan: 'pro' };
    expect(await resolveChatContext(obj)).toBe(obj);
  });

  it("resolves 'auto' via buildAutoPageContext (browser)", async () => {
    await withBrowserAsync(
      { href: 'https://d/x', pathname: '/x', title: 'T' },
      async () => {
        expect(await resolveChatContext('auto')).toEqual({
          url: 'https://d/x',
          path: '/x',
          title: 'T',
        });
      },
    );
  });

  it("resolves 'auto' to {} server-side", async () => {
    expect(await resolveChatContext('auto')).toEqual({});
  });

  it('calls a sync function form', async () => {
    expect(await resolveChatContext(() => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it('awaits an async function form', async () => {
    expect(await resolveChatContext(async () => ({ b: 2 }))).toEqual({ b: 2 });
  });

  it('degrades a throwing function to {} and warns (once)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Two failing resolutions back-to-back: the result degrades every time,
    // but the console warning is one-shot (module-level guard).
    const boom = () => {
      throw new Error('nope');
    };
    expect(await resolveChatContext(boom)).toEqual({});
    expect(await resolveChatContext(async () => Promise.reject(new Error('nope2')))).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// Async variant of withBrowser for the async resolver tests.
async function withBrowserAsync(
  opts: { href?: string; pathname?: string; hash?: string; title?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const priorWindow = g.window;
  const priorDocument = g.document;
  g.window = { location: { href: opts.href, pathname: opts.pathname, hash: opts.hash } };
  g.document = { title: opts.title };
  try {
    await fn();
  } finally {
    if (priorWindow === undefined) delete g.window;
    else g.window = priorWindow;
    if (priorDocument === undefined) delete g.document;
    else g.document = priorDocument;
  }
}

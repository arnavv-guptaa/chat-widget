/**
 * Ingestion loaders — turn an `IngestSource` into one or more concrete leaf
 * documents (a `ref` + raw body + mediaType + title).
 *
 * SECURITY (ingest runs admin-side, but defence-in-depth still applies):
 *   • url/sitemap/crawl fetch with a timeout + custom UA and an SSRF guard:
 *     reject `file:`/`localhost`/private/loopback/link-local IP ranges and cloud
 *     metadata endpoints. The validated IP is PINNED to the socket via a custom
 *     `safeLookup` dispatcher, so the address we vetted is the address we
 *     connect to — no second, unvalidated DNS resolution (closes the
 *     DNS-rebinding TOCTOU window where a host re-resolves to an internal IP
 *     between the check and the connect).
 *   • redirects are followed MANUALLY (`redirect: 'manual'`), capped at
 *     `MAX_REDIRECTS` hops, and EVERY hop is re-validated (host + http(s)-only +
 *     pinned lookup) before it is followed — a 3xx to `http://169.254.169.254`
 *     or `http://localhost` can't smuggle us into the internal network.
 *   • crawl enforces maxDepth, maxPages, and same-origin / allowDomains so one
 *     ingest can't walk the internet or be steered into the internal network.
 *   • file sources read through the host's StorageAdapter (private, user-bound),
 *     never an arbitrary filesystem path from the request.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import type { IngestOptions, IngestSource } from './types';
import type { StorageAdapter } from '../storage-adapter';
import { extractTitle, htmlToCleanText } from './extract';
import { isBlockedIp, isBlockedHostname } from '../net-guard';

// The SSRF block-list lives in one place (../net-guard), shared with the MCP
// connector so the two outbound-fetch surfaces can't drift. Re-exported to
// preserve the existing @mordn/chat-widget/server/knowledge export surface.
export { isBlockedIp };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_UA = 'mordn-chat-widget-ingest/1.0 (+https://github.com/arnavv-guptaa/chat-widget)';
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_DEPTH = 2;
/** Cap redirect hops so a redirect chain can't be used to loop or stall. */
const MAX_REDIRECTS = 5;

/** A concrete unit to fetch+extract+chunk. */
export interface LeafSource {
  /** Stable source ref (URL / file key / synthetic id). The dedupe/cite unit. */
  ref: string;
  /** Source kind for metadata/provenance. */
  kind: IngestSource['type'];
  title?: string;
}

/** Loaded raw content for a leaf. */
export interface LoadedContent {
  body: string;
  mediaType: string;
  title?: string;
}

// ── SSRF guard ───────────────────────────────────────────────────────────────
// `isBlockedIp` / `isBlockedHostname` are imported from ../net-guard (the shared
// block-list). `safeLookup` below adds the loader-specific hardening on top: it
// PINS the vetted IP to the socket via undici's connector, closing the
// DNS-rebinding TOCTOU window for the ingest fetch path.

/**
 * A `dns.lookup`-shaped resolver (the shape undici's `connect.lookup` expects)
 * that RESOLVES the host, rejects if ANY resolved address is non-public, and
 * hands back the vetted addresses. Because the connector dials these exact
 * addresses, the IP we validated is the IP we connect to — there is no second
 * DNS round-trip the attacker can race (DNS-rebinding TOCTOU). A literal-IP host
 * is validated directly without a resolution.
 */
function safeLookup(
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
): void {
  // undici always calls with { all: true }; honour the requested shape anyway.
  const wantAll =
    typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;

  if (isBlockedHostname(hostname)) {
    callback(new Error(`Blocked internal hostname: ${hostname}`) as NodeJS.ErrnoException, '');
    return;
  }

  // Literal IP: validate in place, no resolution (and so no rebinding window).
  const literal = isIP(hostname);
  if (literal !== 0) {
    if (isBlockedIp(hostname)) {
      callback(new Error(`Blocked IP: ${hostname}`) as NodeJS.ErrnoException, '');
      return;
    }
    if (wantAll) callback(null, [{ address: hostname, family: literal }]);
    else callback(null, hostname, literal);
    return;
  }

  lookup(hostname, { all: true })
    .then((results) => {
      if (results.length === 0) {
        callback(new Error(`DNS resolution failed: ${hostname}`) as NodeJS.ErrnoException, '');
        return;
      }
      for (const r of results) {
        if (isBlockedIp(r.address)) {
          callback(
            new Error(`Host ${hostname} resolves to blocked IP ${r.address}`) as NodeJS.ErrnoException,
            '',
          );
          return;
        }
      }
      if (wantAll) {
        callback(
          null,
          results.map((r) => ({ address: r.address, family: r.family })),
        );
      } else {
        callback(null, results[0].address, results[0].family);
      }
    })
    .catch((err: unknown) => {
      callback(
        err instanceof Error ? (err as NodeJS.ErrnoException) : new Error(String(err)),
        '',
      );
    });
}

/**
 * One shared dispatcher whose connector pins every TCP connection (initial
 * request AND each redirect hop) to a `safeLookup`-validated address. The cast
 * keeps us decoupled from the exact `LookupFunction` overload shape across
 * undici/@types versions; `safeLookup` already matches it structurally (the
 * `net.LookupFunction` signature undici's connector invokes).
 */
const safeAgent = new Agent({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect: { lookup: safeLookup as any },
});

/**
 * Validate a URL is safe to *attempt*: https/http only, not a blocked hostname,
 * and (if a literal IP) public. The authoritative public-IP enforcement happens
 * at connect time via `safeLookup`; this is the cheap, fail-fast pre-check that
 * also applies the `allowDomains` policy. Throws on violation.
 */
function assertSafeUrl(raw: string, allowDomains?: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked non-http(s) URL: ${raw}`);
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Blocked internal hostname: ${url.hostname}`);
  }
  if (allowDomains && allowDomains.length) {
    const ok = allowDomains.some(
      (d) => url.hostname === d || url.hostname.endsWith(`.${d}`),
    );
    if (!ok) throw new Error(`Host ${url.hostname} not in allowDomains`);
  }
  if (isIP(url.hostname) && isBlockedIp(url.hostname)) {
    throw new Error(`Blocked IP: ${url.hostname}`);
  }
  return url;
}

/**
 * The ONE fetch seam. Centralises every ingestion network rail:
 *   • per-URL SSRF pre-check (`assertSafeUrl`) + connect-time pinned `safeLookup`
 *   • manual redirect following with a hop cap, re-validating EACH target
 *   • request timeout
 * `allowDomains` (when set) is enforced on the initial URL *and* every redirect
 * target, so a redirect can't escape the allowlist.
 */
async function safeFetch(raw: string, opts: IngestOptions['crawl']): Promise<LoadedContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let current = assertSafeUrl(raw, opts?.allowDomains).toString();

    // `dispatcher` is an undici extension to RequestInit (Node's global fetch is
    // undici-backed) and isn't in the lib.dom `RequestInit` type — widen here.
    const init: RequestInit & { dispatcher?: unknown } = {
      signal: controller.signal,
      redirect: 'manual', // we follow by hand so each target is re-validated
      dispatcher: safeAgent,
      headers: { 'User-Agent': opts?.userAgent ?? DEFAULT_UA, Accept: 'text/html,text/plain,*/*' },
    };

    for (let hop = 0; ; hop++) {
      const res = await fetch(current, init);

      // Redirect: validate the next hop (host + http(s) + allowDomains + pinned
      // lookup) BEFORE following it, and cap the chain length.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`Redirect without Location from ${current}`);
        if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${raw}`);
        // Resolve relative redirects against the current URL, then re-vet.
        const nextUrl = new URL(location, current).toString();
        current = assertSafeUrl(nextUrl, opts?.allowDomains).toString();
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`);
      const mediaType = (res.headers.get('content-type') ?? 'text/plain').split(';')[0].trim();
      const body = await res.text();
      return { body, mediaType, title: mediaType.includes('html') ? extractTitle(body) : undefined };
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Source expansion (sitemap/crawl → leaves) ────────────────────────────────

/** Extract <loc> URLs from a sitemap XML body. */
function parseSitemap(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

/** Extract same-page links for crawling (absolute-resolved). */
function parseLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(new URL(m[1], base).toString());
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * Expand multi-doc sources (sitemap/crawl) into concrete leaf refs, and pass
 * single-doc sources through. Crawl is BFS bounded by depth + page count and
 * fenced to the same origin (or allowDomains).
 */
export async function expandSources(
  sources: IngestSource[],
  opts: IngestOptions,
): Promise<LeafSource[]> {
  const leaves: LeafSource[] = [];
  for (const src of sources) {
    if (src.type === 'url') {
      leaves.push({ ref: src.url, kind: 'url', title: src.title });
    } else if (src.type === 'text') {
      leaves.push({ ref: src.title ? `text:${src.title}` : `text:${hashShort(src.text)}`, kind: 'text', title: src.title });
    } else if (src.type === 'file') {
      const ref = src.fileKey ?? src.path ?? src.filename ?? `file:${Date.now()}`;
      leaves.push({ ref, kind: 'file', title: src.filename });
    } else if (src.type === 'sitemap') {
      const { body } = await safeFetch(src.url, opts.crawl);
      const urls = parseSitemap(body).slice(0, src.limit ?? opts.crawl?.maxPages ?? DEFAULT_MAX_PAGES);
      for (const u of urls) leaves.push({ ref: u, kind: 'sitemap' });
    } else if (src.type === 'crawl') {
      const crawled = await crawl(src, opts);
      for (const u of crawled) leaves.push({ ref: u, kind: 'crawl' });
    }
  }
  return leaves;
}

async function crawl(src: Extract<IngestSource, { type: 'crawl' }>, opts: IngestOptions): Promise<string[]> {
  const maxDepth = src.depth ?? opts.crawl?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = src.maxPages ?? opts.crawl?.maxPages ?? DEFAULT_MAX_PAGES;
  const sameOrigin = src.sameOriginOnly ?? opts.crawl?.sameOriginOnly ?? true;
  const start = new URL(src.url);
  const seen = new Set<string>();
  const out: string[] = [];
  let frontier: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];

  while (frontier.length && out.length < maxPages) {
    const next: Array<{ url: string; depth: number }> = [];
    for (const { url, depth } of frontier) {
      if (out.length >= maxPages) break;
      if (seen.has(url)) continue;
      seen.add(url);
      let loaded: LoadedContent;
      try {
        loaded = await safeFetch(url, opts.crawl);
      } catch {
        continue; // skip unreachable/blocked pages
      }
      out.push(url);
      if (depth >= maxDepth) continue;
      if (!loaded.mediaType.includes('html')) continue;
      for (const link of parseLinks(loaded.body, url)) {
        try {
          const lu = new URL(link);
          if (sameOrigin && lu.origin !== start.origin) continue;
          if (!seen.has(lu.toString())) next.push({ url: lu.toString(), depth: depth + 1 });
        } catch {
          /* skip */
        }
      }
    }
    frontier = next;
  }
  return out;
}

// ── Leaf loading ─────────────────────────────────────────────────────────────

/**
 * Load + clean a single leaf into final text. For url/sitemap/crawl this fetches
 * (SSRF-guarded) and runs HTML→text; for text it returns the inline text; for
 * file it reads via the StorageAdapter (deferred to the caller-provided reader).
 */
export async function loadLeaf(
  leaf: LeafSource,
  src: IngestSource | undefined,
  deps: { storage?: StorageAdapter; crawl?: IngestOptions['crawl'] },
): Promise<{ text: string; title?: string; mediaType: string }> {
  if (leaf.kind === 'text') {
    const inline = src && src.type === 'text' ? src.text : '';
    return { text: inline, title: leaf.title, mediaType: 'text/plain' };
  }
  if (leaf.kind === 'file') {
    if (!deps.storage) throw new Error('file source requires a StorageAdapter (pass deps.storage)');
    const fileSrc = src && src.type === 'file' ? src : undefined;
    const key = fileSrc?.fileKey ?? fileSrc?.path ?? leaf.ref;
    const signed = await deps.storage.resign(key);
    if (!signed) throw new Error(`could not resolve file ${key} via storage`);
    const loaded = await safeFetch(signed, deps.crawl);
    const text = loaded.mediaType.includes('html') ? htmlToCleanText(loaded.body) : loaded.body;
    return { text, title: leaf.title ?? fileSrc?.filename, mediaType: fileSrc?.mediaType ?? loaded.mediaType };
  }
  // url / sitemap / crawl
  const loaded = await safeFetch(leaf.ref, deps.crawl);
  const text = loaded.mediaType.includes('html') ? htmlToCleanText(loaded.body) : loaded.body;
  return { text, title: leaf.title ?? loaded.title, mediaType: loaded.mediaType };
}

function hashShort(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

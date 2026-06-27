/**
 * Ingestion loaders — turn an `IngestSource` into one or more concrete leaf
 * documents (a `ref` + raw body + mediaType + title).
 *
 * SECURITY (ingest runs admin-side, but defence-in-depth still applies):
 *   • url/sitemap/crawl fetch with a timeout + custom UA and an SSRF guard:
 *     reject `file:`/`localhost`/private/loopback/link-local IP ranges and cloud
 *     metadata endpoints; resolve DNS and re-check the resolved IP before fetch.
 *   • crawl enforces maxDepth, maxPages, and same-origin / allowDomains so one
 *     ingest can't walk the internet or be steered into the internal network.
 *   • file sources read through the host's StorageAdapter (private, user-bound),
 *     never an arbitrary filesystem path from the request.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IngestOptions, IngestSource } from './types';
import type { StorageAdapter } from '../storage-adapter';
import { extractTitle, htmlToCleanText } from './extract';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_UA = 'mordn-chat-widget-ingest/1.0 (+https://github.com/arnavv-guptaa/chat-widget)';
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_DEPTH = 2;

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

/** True if an IP string is private/loopback/link-local/unique-local/metadata. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 10) return true; // 10/8
    if (o[0] === 127) return true; // loopback
    if (o[0] === 0) return true; // 0/8
    if (o[0] === 169 && o[1] === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT 100.64/10
    if (o[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('::ffff:')) return isBlockedIp(lower.slice(7)); // v4-mapped
    return false;
  }
  return false;
}

/** Hostnames that are never fetchable regardless of resolution. */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h === 'metadata.google.internal'
  );
}

/**
 * Validate a URL is safe to fetch: https/http only, not a blocked hostname, and
 * its DNS-resolved address is public. Throws on violation.
 */
async function assertSafeUrl(raw: string, allowDomains?: string[]): Promise<URL> {
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
  // If the host is a literal IP, check it directly; else resolve and re-check.
  if (isIP(url.hostname)) {
    if (isBlockedIp(url.hostname)) throw new Error(`Blocked IP: ${url.hostname}`);
  } else {
    const results = await lookup(url.hostname, { all: true }).catch(() => []);
    if (results.length === 0) throw new Error(`DNS resolution failed: ${url.hostname}`);
    for (const r of results) {
      if (isBlockedIp(r.address)) {
        throw new Error(`Host ${url.hostname} resolves to blocked IP ${r.address}`);
      }
    }
  }
  return url;
}

async function safeFetch(raw: string, opts: IngestOptions['crawl']): Promise<LoadedContent> {
  await assertSafeUrl(raw, opts?.allowDomains);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(raw, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': opts?.userAgent ?? DEFAULT_UA, Accept: 'text/html,text/plain,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${raw}`);
    const mediaType = (res.headers.get('content-type') ?? 'text/plain').split(';')[0].trim();
    const body = await res.text();
    return { body, mediaType, title: mediaType.includes('html') ? extractTitle(body) : undefined };
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

/**
 * Shared SSRF network guard — the single source of truth for which hosts/IPs
 * the server may connect OUT to. Used by the knowledge ingest loader
 * (`knowledge/loaders.ts`) and the MCP connector (`mcp.ts`) so the private-range
 * block-list can never drift between the two outbound-fetch surfaces.
 *
 * Node-only (uses `node:dns` / `node:net`); server surfaces import it behind
 * `server-only`.
 */

import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h === 'metadata.google.internal'
  );
}

export interface AssertPublicUrlOptions {
  /**
   * Skip the private/internal checks (scheme is still enforced). For operators
   * who intentionally connect to an INTERNAL host (e.g. a self-hosted MCP server
   * on a private network). Off by default — the safe multi-tenant posture.
   */
  allowPrivate?: boolean;
}

/**
 * Assert that a URL is safe for the server to connect OUT to, and return the
 * parsed `URL`. Rejects non-http(s) schemes, blocked internal hostnames, literal
 * private/loopback/link-local/metadata IPs, and hostnames that RESOLVE to any
 * such IP.
 *
 * NOTE: this validates before the connect (DNS is resolved and every returned
 * address checked). Unlike the ingest loader — which additionally PINS the
 * vetted IP to the socket via undici's connector — a caller that hands the URL
 * to a client doing its own DNS (e.g. the MCP transport) has a residual
 * DNS-rebinding TOCTOU window. It still blocks the overwhelming majority of SSRF
 * (literal IPs, metadata endpoints, hosts that resolve internal) and is a hard
 * prerequisite before connecting to a user/developer-supplied endpoint.
 */
export async function assertPublicHttpUrl(
  rawUrl: string,
  opts: AssertPublicUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme (only http/https allowed): ${url.protocol}`);
  }
  if (opts.allowPrivate) return url;

  // `url.hostname` keeps brackets for IPv6 literals (e.g. "[::1]") — strip them.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (isBlockedHostname(host)) {
    throw new Error(`Blocked internal hostname: ${host}`);
  }
  // Literal IP: validate directly (no resolution).
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) throw new Error(`Blocked private/internal IP: ${host}`);
    return url;
  }
  // Hostname: resolve and reject if ANY resolved address is non-public.
  let results: Array<{ address: string; family: number }>;
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  if (results.length === 0) throw new Error(`DNS resolution failed for ${host}`);
  for (const r of results) {
    if (isBlockedIp(r.address)) {
      throw new Error(`${host} resolves to a blocked IP (${r.address})`);
    }
  }
  return url;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS so hostname resolution is deterministic and offline. `vi.mock` is
// hoisted above the imports below, so net-guard picks up the mocked `lookup`.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { isBlockedIp, isBlockedHostname, assertPublicHttpUrl } from '../src/server/net-guard';

const lookupMock = vi.mocked(lookup);
beforeEach(() => lookupMock.mockReset());

describe('isBlockedIp', () => {
  it('blocks private / loopback / link-local / CGNAT / metadata IPv4', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '224.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it('allows public IPv4 and non-private 172/100 ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.63.0.1', '93.184.216.34']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
  it('handles IPv6 loopback / link-local / unique-local / v4-mapped', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fd12::1')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true); // v4-mapped loopback
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false); // public
  });
});

describe('isBlockedHostname', () => {
  it('blocks localhost + internal TLDs + cloud metadata host', () => {
    for (const h of ['localhost', 'foo.localhost', 'svc.internal', 'db.local', 'metadata.google.internal']) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });
  it('allows normal public hostnames', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('api.mordn.dev')).toBe(false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes (no DNS)', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow();
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects literal private / metadata IPs and internal hostnames (no DNS)', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://10.1.2.3/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://[::1]/')).rejects.toThrow(); // bracketed IPv6 loopback
    await expect(assertPublicHttpUrl('http://localhost/')).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a literal public IP without resolving', async () => {
    await expect(assertPublicHttpUrl('https://8.8.8.8/')).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks a hostname that RESOLVES to a private IP (anti-SSRF via DNS)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(assertPublicHttpUrl('https://rebind.evil.example/')).rejects.toThrow();
    expect(lookupMock).toHaveBeenCalledOnce();
  });

  it('allows a hostname that resolves to a public IP', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(assertPublicHttpUrl('https://example.com/')).resolves.toBeInstanceOf(URL);
  });

  it('blocks when ANY resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never);
    await expect(assertPublicHttpUrl('https://mixed.example/')).rejects.toThrow();
  });

  it('allowPrivate skips the private checks but still enforces the scheme', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl('ftp://127.0.0.1/', { allowPrivate: true })).rejects.toThrow();
  });
});

'use client';

/**
 * Hosted runtime mode — the client half.
 *
 * In server mode the browser talks to the host app's own route, which resolves
 * the user from ITS session; the widget sends nothing about identity. In hosted
 * mode there is no host route: the widget talks to api.mordn.com directly, and
 * identity travels as a token the app's identity provider SIGNED (Supabase Auth,
 * Clerk, Auth0, …), which chat-api verifies against the agent's configured JWKS.
 * The browser still never asserts who it is — it can only present a token
 * somebody else signed.
 *
 * This hook turns `getUserToken` into the `Authorization: Bearer …` header the
 * transport sends, keeps it fresh (identity-provider access tokens expire; we
 * re-ask every few minutes, and `refresh()` lets a host force it), and — only when the host
 * opted into anonymous visitors — supplies the `X-Mordn-Visitor` id, a random
 * value persisted in localStorage that isolates one browser profile from
 * another. It is deliberately NOT sent when a token is available.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const HOSTED_BASE_URL = 'https://api.mordn.com';
export const VISITOR_HEADER = 'X-Mordn-Visitor';
const VISITOR_STORAGE_KEY = 'mordn:visitor';
/** Re-ask the host for a token this often (access tokens commonly live ~1h). */
const TOKEN_REFRESH_MS = 4 * 60 * 1000;

export type GetUserToken = () => Promise<string | null | undefined> | string | null | undefined;

/** The apiBase for a publishable key: `${base}/v1/hosted/${key}`. */
export function hostedApiBase(publishableKey: string, hostedBaseUrl: string = HOSTED_BASE_URL): string {
  return `${hostedBaseUrl.replace(/\/+$/, '')}/v1/hosted/${encodeURIComponent(publishableKey.trim())}`;
}

/** A fresh visitor id: 32 url-safe chars (chat-api accepts 16–64). */
export function newVisitorId(): string {
  const cryptoObj = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID().replace(/-/g, '');
  // Fallback for very old runtimes: still random, still url-safe.
  let out = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Read-or-create the persisted visitor id. Falls back to a per-session id when storage is unavailable. */
export function getOrCreateVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const created = newVisitorId();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    return created;
  } catch {
    return newVisitorId();
  }
}

export interface HostedAuthState {
  /** Headers to merge into every request. Empty when off or resolving a new session. */
  headers: Record<string, string>;
  /** False until this session's token resolution settles — bootstrap waits for it. */
  ready: boolean;
  /** Re-resolve within the SAME session, retaining its headers while pending. */
  refresh: () => void;
  /** Discard current auth and re-resolve after login, logout, or account switch. */
  reset: () => void;
  /** Local lifecycle boundary for bootstrap; never identity or a storage scope. */
  session: object;
}

export function useHostedAuth(options: {
  enabled: boolean;
  getUserToken?: GetUserToken;
  anonymous?: boolean;
  /** Change on auth transitions; callback identity deliberately does not trigger resolution. */
  sessionKey?: string | number | null;
}): HostedAuthState {
  const { enabled, getUserToken, anonymous = false, sessionKey } = options;
  const [tick, setTick] = useState(0);
  const [resetTick, setResetTick] = useState(0);
  const hasGetter = !!getUserToken;
  // A changed boundary hides old headers/ready in the render itself, before
  // effect cleanup. Adding/removing a getter and disabling are transitions too.
  const session = useMemo(() => ({}), [enabled, hasGetter, anonymous, sessionKey, resetTick]);
  const [resolved, setResolved] = useState<{ session: object; token: string | null } | null>(null);
  const getTokenRef = useRef(getUserToken);
  getTokenRef.current = getUserToken;
  const requestRef = useRef(0);

  const refresh = useCallback(() => {
    // Invalidate immediately, including promises settling before effect cleanup.
    requestRef.current += 1;
    setTick((n) => n + 1);
  }, []);
  const reset = useCallback(() => {
    requestRef.current += 1;
    setResetTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !hasGetter) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      // Intervals can overlap. Only the latest STARTED resolution may commit,
      // including errors; an older success must not resurrect a logged-out user.
      const request = ++requestRef.current;
      const current = () => !cancelled && request === requestRef.current;
      try {
        const value = await getTokenRef.current?.();
        if (current()) setResolved({ session, token: typeof value === 'string' && value.trim() ? value.trim() : null });
      } catch (error) {
        if (current()) {
          console.error('[chat-widget] getUserToken threw; continuing without a user token.', error);
          setResolved({ session, token: null });
        }
      }
    };
    void resolve();
    const interval = window.setInterval(resolve, TOKEN_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, hasGetter, session, tick]);

  const ready = !enabled || !hasGetter || resolved?.session === session;
  const token = enabled && hasGetter && resolved?.session === session ? resolved.token : null;
  const visitorId = useMemo(() => (enabled && anonymous ? getOrCreateVisitorId() : null), [enabled, anonymous]);

  const headers = useMemo(() => {
    const out: Record<string, string> = {};
    if (!enabled || !ready) return out;
    if (token) out.Authorization = `Bearer ${token}`;
    else if (visitorId) out[VISITOR_HEADER] = visitorId;
    return out;
  }, [enabled, ready, token, visitorId]);

  return { headers, ready, refresh, reset, session };
}

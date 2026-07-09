/**
 * Action transport client util.
 *
 * Posts a typed action invocation to the hosted backend so server- and
 * hosted-handled actions (lead capture, booking request, cart lookup…) execute
 * on the server behind the SAME verified-identity boundary the chat turns use.
 * It reuses the exact transport the widget already uses for chat and feedback:
 * the caller passes the widget's `apiBase` and the headers `DefaultChatTransport`
 * sends (`X-User-Id` + any host `extraHeaders`), and this POSTs to
 * `${base}/v1/action`. The Next.js handler mounted at `apiBase` resolves the
 * VERIFIED user (never the client-sent id) and runs the host's `onAction` seam.
 *
 * Contract: BEST-EFFORT and SILENT on transport failures. It never throws into
 * the UI. It resolves to the parsed {@link MordnActionResult} on a 2xx JSON
 * response, or `null` when skipped (no base) / on any network or non-2xx error —
 * so a rendered button can show a generic failure without the call ever breaking
 * the chat. This mirrors `submitFeedback`'s degrade-cleanly posture; the only
 * difference is actions carry a return value the UI may use.
 *
 * Degrades cleanly with no network: when `base` is empty/whitespace (headless
 * render, BYO backend that opts out, or an unauthenticated widget) the network
 * call is skipped entirely and the caller relies on the host `onAction`
 * (client-side) handler, if any.
 */

import type { MordnActionConfig, MordnActionResult } from '../actions/types';

/**
 * Best-effort POST of an action to `${base}/v1/action`.
 *
 * @param base    The widget's `apiBase` (e.g. `/api/chat`). Falsy/blank → skip.
 * @param headers The same headers the chat transport sends — typically
 *                `{ 'X-User-Id': userId, ...extraHeaders }`. `Content-Type` is
 *                added here so callers don't have to.
 * @param action  The action being invoked (type/payload/idempotencyKey/…).
 * @param values  Optional form/selection values merged by the emitting primitive.
 * @returns A promise that ALWAYS resolves (never rejects): the server's
 *          {@link MordnActionResult} on success, else `null`.
 */
export async function submitAction(
  base: string | undefined,
  headers: Record<string, string> | undefined,
  action: MordnActionConfig,
  values?: Record<string, unknown>,
): Promise<MordnActionResult | null> {
  const trimmed = (base ?? '').trim();
  if (!trimmed) return null;

  // Normalise to avoid a double slash on a trailing "/" (mirrors the hosted
  // store's `baseUrl.replace(/\/$/, '')` and submitFeedback).
  const url = `${trimmed.replace(/\/+$/, '')}/v1/action`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      // Actions can carry per-user data; never let a patched fetch cache serve
      // one user's action result to another (same rule as the hosted GETs).
      cache: 'no-store',
      headers: {
        ...(headers ?? {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: action.type,
        // The server re-validates payload authoritatively; this is untrusted.
        payload: values ? { ...(action.payload as object | undefined), ...values } : action.payload,
        idempotencyKey: action.idempotencyKey,
        confirmation: action.confirmation,
      }),
    });
    if (!res.ok) {
      console.debug('[chat-widget] action POST rejected:', res.status);
      return null;
    }
    // A 200 with no/invalid JSON body (e.g. a clean no-op ack) is still success.
    try {
      const data = (await res.json()) as MordnActionResult;
      return data && typeof data === 'object' ? data : { status: 'success' };
    } catch {
      return { status: 'success' };
    }
  } catch (err) {
    console.debug('[chat-widget] action POST failed:', err);
    return null;
  }
}

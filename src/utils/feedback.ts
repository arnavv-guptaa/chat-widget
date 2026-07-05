/**
 * Message-feedback client util.
 *
 * Posts a thumbs up/down (optionally with a freeform reason) to the hosted
 * backend so product teams can measure answer quality. It reuses the SAME
 * transport the widget already uses for chat: the caller passes the widget's
 * `apiBase` and the exact headers `DefaultChatTransport` sends (`X-User-Id`
 * plus any host `extraHeaders`), and this posts to `${base}/v1/feedback` — the
 * same `/v1` hosted-API convention as `/v1/conversations`, `/v1/uploads`, etc.
 * The Next.js handler mounted at `apiBase` forwards it to the hosted service
 * with the server-side `Authorization: Bearer <apiKey>` + `X-Chat-User`
 * (exactly as it does for turns/history) — the browser never holds the secret.
 *
 * Contract: BEST-EFFORT and SILENT. It never throws into the UI and never
 * rejects — network / HTTP errors are swallowed (logged via `console.debug`)
 * so a failed telemetry POST can't break the chat. Feedback is a side signal,
 * not a user-blocking action; the host `onFeedback` callback is the source of
 * truth and always fires regardless of this call's outcome.
 *
 * Degrades cleanly with no network: when the widget is NOT in hosted mode —
 * i.e. `base` is empty/whitespace (headless render, BYO backend that opts out,
 * or an unauthenticated widget with no `userId`) — the network call is skipped
 * entirely and the caller relies solely on `onFeedback`. This keeps
 * server-rendered / offline usage side-effect-free.
 */

/** Thumbs rating on an assistant message. */
export type FeedbackRating = 'up' | 'down';

/** Payload recorded for a single feedback submission. */
export interface FeedbackSubmission {
  /** Active conversation id (the widget's tab / useChat id). Optional: a
   *  brand-new conversation may not have been persisted server-side yet. */
  conversationId?: string;
  /** Id of the assistant message being rated (`UIMessage.id`). */
  messageId: string;
  /** Thumbs up or down. */
  rating: FeedbackRating;
  /** Optional freeform reason, typically revealed on thumbs-down. */
  reason?: string;
}

/**
 * Best-effort POST of feedback to `${base}/v1/feedback`.
 *
 * @param base    The widget's `apiBase` (e.g. `/api/chat`). Falsy/blank → skip
 *                the network call (headless / BYO / unauthenticated).
 * @param headers The same headers the chat transport sends — typically
 *                `{ 'X-User-Id': userId, ...extraHeaders }`. `Content-Type` is
 *                added here so callers don't have to.
 * @param body    The feedback submission.
 * @returns A promise that ALWAYS resolves (never rejects). `true` if the POST
 *          was attempted and the server accepted it (2xx); `false` if the call
 *          was skipped (no base) or the request failed / was rejected.
 */
export async function submitFeedback(
  base: string | undefined,
  headers: Record<string, string> | undefined,
  body: FeedbackSubmission,
): Promise<boolean> {
  // Not hosted / no base URL → rely solely on the host `onFeedback` callback.
  // Trim so an accidental whitespace-only base is treated as absent.
  const trimmed = (base ?? '').trim();
  if (!trimmed) return false;

  // Normalise to avoid a double slash when the caller passes a trailing "/"
  // (mirrors the hosted store's `baseUrl.replace(/\/$/, '')`).
  const url = `${trimmed.replace(/\/+$/, '')}/v1/feedback`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...(headers ?? {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: body.conversationId,
        messageId: body.messageId,
        rating: body.rating,
        // Only send `reason` when non-empty so the payload stays clean.
        ...(body.reason && body.reason.trim() ? { reason: body.reason.trim() } : {}),
      }),
    });
    if (!res.ok) {
      // Swallow non-2xx — telemetry must never surface as a UI error.
      console.debug('[chat-widget] feedback POST rejected:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    // Network failure (offline, blocked, CORS, aborted) — best-effort, ignore.
    console.debug('[chat-widget] feedback POST failed:', err);
    return false;
  }
}

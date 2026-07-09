'use client';

/**
 * useActionDispatcher — the runtime that makes GUI parts *do* something.
 *
 * The #217 primitives (ActionButton, ActionForm, SelectionGroup, cards…) all take
 * an `onAction` dispatcher and call it with a {@link MordnActionEvent} when the
 * user interacts. This hook produces the single dispatcher the whole transcript
 * shares, applying a small, predictable resolution order:
 *
 *   1. Host `onAction` (if provided) runs FIRST and can fully own the action.
 *      - If it returns a {@link MordnActionResult}, we use it and stop.
 *      - If it returns `undefined` (didn't handle / just observed), we continue
 *        to the built-in behavior below. This lets a host log every action while
 *        still getting sensible defaults for the ones it doesn't care about.
 *   2. Built-in CLIENT behavior for `handler: 'client'` (or unspecified) actions:
 *      - `mordn.ui.open_url`   → open a safeUrl in a new tab.
 *      - `mordn.ui.send_message` → send payload.text as a normal user turn
 *         (reuses the existing composer submit path).
 *   3. SERVER / HOSTED actions → best-effort POST via {@link submitAction} to the
 *      handler's `/v1/action` route, which resolves the VERIFIED user and runs the
 *      server `onAction` seam. The browser-sent id is never trusted server-side.
 *
 * Guarantees / edge cases:
 *   • Never throws into the UI — a rejected host handler or failed POST is
 *     swallowed (best-effort), matching the feedback path.
 *   • Consequential actions (`handler: 'server'|'hosted'` or `risk: mutation|
 *     regulated`) are GATED while a turn is streaming unless the caller allows it,
 *     so a model mid-stream can't trigger a mutation before the user sees it.
 *     Purely local UI actions remain responsive during streaming.
 *   • Idempotency: the action's `idempotencyKey` is forwarded to the server as-is.
 */

import { useCallback } from 'react';
import type { MordnActionDispatcher, MordnActionEvent, MordnActionResult } from '../actions/types';
import { safeUrl } from '../utils/url-safety';
import { submitAction } from '../utils/action-transport';

/** Built-in client action types the widget understands with no host wiring. */
export const MORDN_CLIENT_ACTIONS = {
  openUrl: 'mordn.ui.open_url',
  sendMessage: 'mordn.ui.send_message',
} as const;

export interface UseActionDispatcherOptions {
  /** Host-provided dispatcher; runs first and may fully own the action. */
  onAction?: MordnActionDispatcher;
  /** Widget apiBase for server/hosted action POSTs. */
  apiBase?: string;
  /** Transport headers (X-User-Id + extraHeaders), same as chat/feedback. */
  headers?: Record<string, string>;
  /** Send a message as a normal user turn (built-in send_message action). */
  sendMessage?: (text: string) => void;
  /** True while a turn is streaming — used to gate consequential actions. */
  isStreaming?: boolean;
}

function isConsequential(event: MordnActionEvent): boolean {
  const handler = event.action.handler;
  const risk = event.action.risk;
  return handler === 'server' || handler === 'hosted' || risk === 'mutation' || risk === 'regulated';
}

export function useActionDispatcher(options: UseActionDispatcherOptions): MordnActionDispatcher {
  const { onAction, apiBase, headers, sendMessage, isStreaming } = options;

  return useCallback<MordnActionDispatcher>(
    async (event) => {
      // Gate consequential actions during streaming: they must wait for the turn
      // to settle so the user isn't mutated behind a still-rendering answer.
      if (isStreaming && isConsequential(event)) return;

      // 1. Host handler first. It may fully own the action (returns a result) or
      //    just observe (returns undefined → fall through to built-ins).
      if (onAction) {
        try {
          const result = await onAction(event);
          if (result) return result;
        } catch {
          // A throwing host handler must not break the UI — treat as unhandled.
        }
      }

      const { action, values } = event;
      const handler = action.handler ?? 'client';

      // 2. Built-in client behaviors — only for client-handled actions.
      if (handler === 'client') {
        if (action.type === MORDN_CLIENT_ACTIONS.openUrl) {
          const raw = (values?.url ?? (action.payload as { url?: string } | undefined)?.url) as string | undefined;
          const href = safeUrl(raw);
          if (href && typeof window !== 'undefined') {
            window.open(href, '_blank', 'noopener,noreferrer');
            return { status: 'success' } satisfies MordnActionResult;
          }
          return { status: 'error', errorCode: 'unsafe_url' } satisfies MordnActionResult;
        }
        if (action.type === MORDN_CLIENT_ACTIONS.sendMessage) {
          const text = (values?.text ?? (action.payload as { text?: string } | undefined)?.text) as string | undefined;
          if (text && sendMessage) {
            sendMessage(text);
            return { status: 'success' } satisfies MordnActionResult;
          }
          return { status: 'error', errorCode: 'no_message' } satisfies MordnActionResult;
        }
        // Unknown client action with no host handler → nothing to do.
        return;
      }

      // 3. Server / hosted actions → best-effort POST to the handler route.
      const result = await submitAction(apiBase, headers, action, values);
      return result ?? { status: 'error', errorCode: 'action_failed' };
    },
    [onAction, apiBase, headers, sendMessage, isStreaming],
  );
}

"use client";

/**
 * Inline error banner shown above the chat input when a stream errors,
 * disconnects, or the model returns an error finish reason. Generic —
 * the consumer doesn't customise content, just wires up the actions
 * via the props below.
 *
 * Styling uses the widget's `--chat-*` tokens, so it picks up the host
 * app's theme without extra wiring. Inline (not toast) so the user
 * doesn't lose context of what they were just doing.
 */

import { AlertTriangleIcon, XIcon } from "lucide-react";

// These strings are emitted by the server taxonomy and contain no provider
// detail. Keep the raw network/provider message off-screen, but preserve the
// package-owned guidance instead of collapsing every category to a generic line.
const SAFE_SERVER_MESSAGES = new Set([
  "The assistant is handling a lot of requests right now. Please try again in a moment.",
  "The assistant is not configured correctly. Please contact support.",
  "The assistant is temporarily unavailable. Please try again.",
  "I can't help with that request.",
  "That request couldn't be processed. Try rephrasing or shortening your message.",
  "The configured model could not complete this request. Try a different request or contact support.",
  "A tool the assistant was using failed. Please try again.",
  "An error occurred while generating the response.",
]);

const NON_RETRYABLE_SERVER_MESSAGES = new Set([
  "The assistant is not configured correctly. Please contact support.",
  "I can't help with that request.",
  "That request couldn't be processed. Try rephrasing or shortening your message.",
  "The configured model could not complete this request. Try a different request or contact support.",
]);

export interface ChatErrorBannerProps {
  /** The error to surface. When null, the component renders nothing. */
  error: Error | null | undefined;
  /** Whether to show the "Try again" affordance. Hidden when there is
   *  no last user message to regenerate from. */
  canRetry?: boolean;
  /** Click handler for "Try again" — typically `useChat().regenerate`. */
  onRetry?: () => void;
  /** Click handler for the dismiss X — typically `useChat().clearError`. */
  onDismiss?: () => void;
}

export function ChatErrorBanner({
  error,
  canRetry = true,
  onRetry,
  onDismiss,
}: ChatErrorBannerProps) {
  if (!error) return null;

  // A user-initiated Stop surfaces through useChat's error state as an
  // AbortError. That is not a failure — the partial answer is already on
  // screen and persisted — so rendering an alert banner for it (previously a
  // softened "Stopped." with a warning icon and a Try again link) read as
  // "the generation errored". Client-side aborts only come from the stop
  // button or navigation; real server-side failures arrive as error chunks
  // with their own messages and still render below.
  if (error.name === "AbortError" || error.message === "The response was aborted.") return null;

  // Default message kept short — the raw Error.message can be a wall of
  // text from the network layer. We only surface it on hover via title.
  const friendly = friendlyErrorMessage(error);
  const retryable = !NON_RETRYABLE_SERVER_MESSAGES.has(error.message ?? "");

  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-2 rounded-[9px] px-3 py-2.5 text-[13px]"
      style={{
        backgroundColor: "hsl(var(--chat-surface))",
        border: "1px solid hsl(var(--chat-border-soft))",
      }}
      title={error.message}
    >
      <AlertTriangleIcon
        className="size-3.5 flex-shrink-0"
        style={{ color: "hsl(var(--chat-text-faint))" }}
      />
      <div className="flex-1 min-w-0">
        <span style={{ color: "hsl(var(--chat-text-body))" }}>{friendly}</span>
      </div>
      {canRetry && retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-sm text-[12px] font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
          style={{ color: "hsl(var(--chat-text-body))" }}
        >
          Try again
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 flex size-5 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[hsl(var(--chat-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
          style={{ color: "hsl(var(--chat-text-faint))" }}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

function friendlyErrorMessage(error: Error): string {
  const raw = error.message ?? "";
  if (SAFE_SERVER_MESSAGES.has(raw)) return raw;
  if (/network|fetch|disconnect|ECONN/i.test(raw)) {
    return "Connection issue. Check your network and try again.";
  }
  if (/rate.?limit|429/i.test(raw)) {
    return "You're sending messages too fast. Wait a moment and try again.";
  }
  if (/timeout/i.test(raw)) return "The response took too long.";
  return "Something went wrong while generating the response.";
}

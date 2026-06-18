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

  // Default message kept short — the raw Error.message can be a wall of
  // text from the network layer. We only surface it on hover via title.
  const friendly = friendlyErrorMessage(error);

  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-3 py-2 mb-2 rounded-lg text-[13px]"
      style={{
        backgroundColor: "hsl(var(--chat-text)/0.04)",
        border: "1px solid var(--chat-divider)",
      }}
      title={error.message}
    >
      <AlertTriangleIcon
        className="size-4 mt-0.5 flex-shrink-0"
        style={{ color: "hsl(var(--chat-text)/0.6)" }}
      />
      <div className="flex-1 min-w-0">
        <span style={{ color: "hsl(var(--chat-text)/0.85)" }}>{friendly}</span>
      </div>
      {canRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[12px] font-medium underline-offset-2 hover:underline"
          style={{ color: "hsl(var(--chat-text)/0.85)" }}
        >
          Try again
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 -mr-1 -mt-0.5 p-1 rounded hover:bg-[hsl(var(--chat-text)/0.06)] transition-colors"
          style={{ color: "hsl(var(--chat-text)/0.5)" }}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function friendlyErrorMessage(error: Error): string {
  const raw = error.message ?? "";
  if (/abort/i.test(raw)) return "Stopped.";
  if (/network|fetch|disconnect|ECONN/i.test(raw)) {
    return "Connection issue. Check your network and try again.";
  }
  if (/rate.?limit|429/i.test(raw)) {
    return "You're sending messages too fast. Wait a moment and try again.";
  }
  if (/timeout/i.test(raw)) return "The response took too long.";
  return "Something went wrong while generating the response.";
}

"use client";

/**
 * Action row rendered under an assistant message. Generic — the host
 * decides which actions to show. Today: copy + regenerate + optional
 * thumbs up/down feedback. Future additions (share, branch, etc.) plug
 * in here without bespoke wiring at every call site.
 *
 * Visibility: subtle row, low-contrast. Hover-darkening on each
 * button. Always shown for the LAST assistant message, hidden for
 * earlier ones unless the consumer overrides via `alwaysVisible`.
 */

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  RotateCcwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SendHorizontalIcon,
} from "lucide-react";
import { cn } from "../utils/cn";
import { submitFeedback } from "../utils/feedback";
import type { FeedbackEvent } from "../types";

export interface MessageActionsProps {
  /** Plain-text representation of the message used for copy. */
  text: string;
  /** Click handler for regenerate — typically `useChat().regenerate`.
   *  Pass undefined to hide the button. */
  onRegenerate?: () => void;
  /** Disabled state for regenerate (e.g. while a new turn is streaming). */
  regenerateDisabled?: boolean;
  /** When true, actions stay visible; otherwise they reveal on hover/focus of
   *  the parent message (which must be a `group`). Used for the last message. */
  alwaysVisible?: boolean;
  className?: string;

  // ── Feedback (thumbs up/down) — all optional, off by default ──────────────
  /** Show the thumbs up/down control (opt-in via `config.feedback`). */
  feedbackEnabled?: boolean;
  /** Id of the assistant message being rated. Required to record feedback. */
  messageId?: string;
  /** Active conversation id, threaded through for the feedback payload. */
  conversationId?: string;
  /** Widget `apiBase`; passed to `submitFeedback`. Falsy → network call skipped
   *  (headless / BYO) and only `onFeedback` fires. */
  feedbackApiBase?: string;
  /** Headers mirroring the chat transport (`X-User-Id` + host extras) for the
   *  best-effort feedback POST. */
  feedbackHeaders?: Record<string, string>;
  /** Credentials mode mirroring the chat transport (cross-origin cookie auth). */
  feedbackCredentials?: RequestCredentials;
  /** Host callback fired on every submission (fires even with no network). */
  onFeedback?: (feedback: FeedbackEvent) => void;
}

export function MessageActions({
  text,
  onRegenerate,
  regenerateDisabled,
  alwaysVisible,
  className,
  feedbackEnabled,
  messageId,
  conversationId,
  feedbackApiBase,
  feedbackHeaders,
  feedbackCredentials,
  onFeedback,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  // Which thumb is currently selected (null until the user rates). Reflected
  // via aria-pressed so assistive tech announces the toggle state.
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  // Whether the thumbs-down reason box is open, and its current text.
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  // Drives the polite sr-only confirmation after a submission lands.
  const [submitted, setSubmitted] = useState(false);

  // Timer id for the "copied" flash, so a rapid re-copy (or unmount) can
  // clear the pending reset instead of leaking it.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browsers without clipboard access — silently no-op.
    }
  };

  // Records a rating: fires the best-effort network POST (skipped when there's
  // no base URL) AND the host callback. Kept side-effect-safe — submitFeedback
  // never throws, so a telemetry failure can't break the click.
  const record = (r: "up" | "down", withReason?: string) => {
    if (!feedbackEnabled || !messageId) return;
    const trimmedReason = withReason && withReason.trim() ? withReason.trim() : undefined;
    // Best-effort backend record — resolves regardless of outcome; ignore result.
    void submitFeedback(feedbackApiBase, feedbackHeaders, {
      conversationId,
      messageId,
      rating: r,
      reason: trimmedReason,
    }, feedbackCredentials);
    // Always fire the host callback so BYO / headless hosts still get the event.
    onFeedback?.({ messageId, conversationId, rating: r, reason: trimmedReason });
    setSubmitted(true);
  };

  const handleThumbUp = () => {
    setRating("up");
    setShowReason(false);
    setReason("");
    record("up");
  };

  const handleThumbDown = () => {
    setRating("down");
    // Reveal the optional reason box. Submitting a bare thumbs-down still
    // records immediately — the reason is a follow-up refinement, not required.
    setShowReason(true);
    record("down");
  };

  const handleReasonSubmit = () => {
    if (!reason.trim()) {
      // Nothing typed — just close the box; the bare down-vote already recorded.
      setShowReason(false);
      return;
    }
    // Re-record the down-vote now carrying the reason.
    record("down", reason);
    setShowReason(false);
  };

  const showFeedback = feedbackEnabled && !!messageId;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 -ml-1.5 transition-opacity duration-150",
        alwaysVisible
          // LAST message: in-flow (small top margin) so it never overlaps the
          // composer sitting just below, and stays visible.
          ? "mt-1.5 opacity-100"
          // Other messages: ABSOLUTELY positioned in the gap below the message so
          // the hidden row adds NO height (it was inflating the assistant→user
          // gap). Reveals on hover/focus of the message group.
          : "absolute left-0 top-full mt-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <ActionButton onClick={handleCopy} ariaLabel="Copy message">
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </ActionButton>
        {onRegenerate && (
          <ActionButton
            onClick={onRegenerate}
            disabled={regenerateDisabled}
            ariaLabel="Regenerate response"
          >
            <RotateCcwIcon className="size-3.5" />
          </ActionButton>
        )}
        {showFeedback && (
          <>
            <ActionButton
              onClick={handleThumbUp}
              ariaLabel="Good response"
              pressed={rating === "up"}
            >
              <ThumbsUpIcon className="size-3.5" />
            </ActionButton>
            <ActionButton
              onClick={handleThumbDown}
              ariaLabel="Bad response"
              pressed={rating === "down"}
            >
              <ThumbsDownIcon className="size-3.5" />
            </ActionButton>
          </>
        )}
        {/* The icon swap (copy → check) is the visual cue; this polite live
            region gives screen-reader users the same confirmation. Also
            announces feedback acknowledgement. */}
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied to clipboard" : submitted ? "Thanks for your feedback" : ""}
        </span>
      </div>

      {/* Thumbs-down reason box — minimal inline input + submit. Optional:
          the down-vote is already recorded; this lets the user add detail.
          Only rendered for the feedback control, and only after a down-vote. */}
      {showFeedback && showReason && (
        <form
          className="flex items-center gap-1.5 pl-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            handleReasonSubmit();
          }}
        >
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            placeholder="What went wrong? (optional)"
            aria-label="Feedback reason"
            className="h-7 min-w-0 max-w-[16rem] flex-1 rounded-[7px] bg-[hsl(var(--chat-surface))] px-2 text-[12px] text-[hsl(var(--chat-text-body))] placeholder:text-[hsl(var(--chat-text-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
          />
          <ActionButton onClick={handleReasonSubmit} ariaLabel="Submit feedback">
            <SendHorizontalIcon className="size-3.5" />
          </ActionButton>
        </form>
      )}
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Toggle state for feedback buttons — reflected via aria-pressed and a
   *  subtle background so the selected thumb reads as active. */
  pressed?: boolean;
  children: React.ReactNode;
}

function ActionButton({ onClick, disabled, ariaLabel, pressed, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      // aria-pressed only when this is a toggle (feedback) button; plain action
      // buttons (copy/regenerate) leave it undefined so they aren't announced
      // as toggles.
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(
        "flex size-[26px] items-center justify-center rounded-[7px] p-0 text-[hsl(var(--chat-text-faint))] transition-colors hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)] disabled:cursor-not-allowed disabled:opacity-40",
        pressed && "bg-[hsl(var(--chat-hover-bg))] text-[hsl(var(--chat-text))]",
      )}
    >
      {children}
    </button>
  );
}

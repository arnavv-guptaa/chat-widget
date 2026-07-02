"use client";

/**
 * Action row rendered under an assistant message. Generic — the host
 * decides which actions to show. Today: copy + regenerate. Future
 * additions (thumbs up/down feedback, share, branch, etc.) plug in
 * here without bespoke wiring at every call site.
 *
 * Visibility: subtle row, low-contrast. Hover-darkening on each
 * button. Always shown for the LAST assistant message, hidden for
 * earlier ones unless the consumer overrides via `alwaysVisible`.
 */

import { useState } from "react";
import { CheckIcon, CopyIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "../utils/cn";

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
}

export function MessageActions({
  text,
  onRegenerate,
  regenerateDisabled,
  alwaysVisible,
  className,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browsers without clipboard access — silently no-op.
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 -ml-1.5 transition-opacity duration-150",
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
      {/* The icon swap (copy → check) is the visual cue; this polite live
          region gives screen-reader users the same confirmation. */}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}

function ActionButton({ onClick, disabled, ariaLabel, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="p-1.5 rounded-md transition-colors hover:bg-[hsl(var(--chat-text)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.3)] disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ color: "hsl(var(--chat-text)/0.55)" }}
    >
      {children}
    </button>
  );
}

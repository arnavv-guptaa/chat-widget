"use client";

import { Button } from "../ui/button";
import { cn } from "../utils/cn";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  /** Receives the actual scroll viewport element (StickToBottom owns it and
   *  exposes it via contextRef.scrollRef — a plain `ref` won't reach it). Used
   *  for reverse-pagination scroll-position management. */
  onScrollRef?: (el: HTMLElement | null) => void;
};

export const Conversation = ({ className, onScrollRef, ...props }: ConversationProps) => (
  // NOTE: the live region lives on ConversationContent (below), NOT here.
  // StickToBottom renders this root as the scroll viewport, with an inner
  // scroll-container div and then the content div (StickToBottom.Content) that
  // actually wraps the streamed message nodes. Putting role="log"/aria-live on
  // the root would (a) scope announcements to the whole viewport — including the
  // floating scroll-to-bottom button — and (b) risk a nested second live region.
  // We scope the live region tightly to the content div instead.
  <StickToBottom
    contextRef={
      onScrollRef
        ? (ctx) => onScrollRef(ctx?.scrollRef.current ?? null)
        : undefined
    }
    className={cn("relative flex-1 overflow-y-auto", className)}
    // `instant` (not `smooth`) for the INITIAL position: when a conversation
    // loads (first mount / tab switch) it should appear already pinned to the
    // bottom, NOT paint at the top and then animate a scroll down — that read as
    // a flashy re-scroll on every tab switch. Live streaming still follows
    // smoothly via `resize`.
    initial="instant"
    resize="smooth"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  // Live region for streamed assistant responses. This is the div that directly
  // wraps the rendered message nodes (StickToBottom wires its `contentRef`
  // here), so appended/changed text lands INSIDE the boundary and is announced.
  //   - role="log": ordered, append-style updates (chat transcript semantics).
  //   - aria-live="polite": announce without interrupting the user.
  //   - aria-atomic="false": announce only what changed, not the whole log.
  //   - aria-relevant="additions text": new nodes + text edits to existing ones.
  // Per-character drip is suppressed for reduced-motion users (see
  // use-smooth-text.ts) so SRs announce coherent chunks rather than fragments.
  <StickToBottom.Content
    aria-atomic="false"
    aria-live="polite"
    aria-relevant="additions text"
    className={cn("p-4", className)}
    role="log"
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

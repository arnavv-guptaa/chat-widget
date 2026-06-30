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
    role="log"
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
  <StickToBottom.Content className={cn("p-4", className)} {...props} />
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

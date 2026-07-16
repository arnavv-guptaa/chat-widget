"use client";

import { cn } from "../utils/cn";
import { type HTMLAttributes } from "react";
import type { StarterPrompt } from "../types";

export type { StarterPrompt };

export type StarterMessagesLayout = 'list' | 'grid';

export type StarterMessagesProps = Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
  prompts: StarterPrompt[];
  onPromptSelect: (prompt: StarterPrompt) => void;
  /**
   * How prompts are laid out.
   * - `'list'` (default): full-width rows separated by dividers — good for
   *   descriptive prompts, optionally with a subtitle.
   * - `'grid'`: a 2-column chip grid — good for short, scannable prompts,
   *   optionally with an icon.
   */
  layout?: StarterMessagesLayout;
};

export function StarterMessages({
  className,
  prompts,
  onPromptSelect,
  layout = 'list',
  ...props
}: StarterMessagesProps) {
  if (prompts.length === 0) return null;

  if (layout === 'grid') {
    return (
      <div
        className={cn("mb-3 grid grid-cols-2 gap-2", className)}
        {...props}
      >
        {prompts.map((prompt, index) => (
          <StarterMessageItem
            key={`${prompt.title}-${index}`}
            prompt={prompt}
            layout="grid"
            onClick={() => onPromptSelect(prompt)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("mb-3 grid gap-2", className)} {...props}>
      {prompts.map((prompt, index) => (
        <StarterMessageItem
          key={`${prompt.title}-${index}`}
          prompt={prompt}
          onClick={() => onPromptSelect(prompt)}
        />
      ))}
    </div>
  );
}

export type StarterMessageItemProps = HTMLAttributes<HTMLButtonElement> & {
  prompt: StarterPrompt;
  layout?: StarterMessagesLayout;
};

export function StarterMessageItem({
  className,
  prompt,
  layout = 'list',
  ...props
}: StarterMessageItemProps) {
  if (layout === 'grid') {
    return (
      <button
        type="button"
        className={cn(
          "h-full text-left px-3 py-2.5 rounded-xl",
          "flex flex-col gap-1",
          "border border-[hsl(var(--chat-border-soft))]",
          "bg-[hsl(var(--chat-background))]",
          "hover:bg-[hsl(var(--chat-surface))] hover:border-[hsl(var(--chat-border))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]",
          "transition-colors duration-150 ease-out",
          "cursor-pointer",
          className
        )}
        {...props}
      >
        {prompt.icon && (
          <span className="text-[hsl(var(--chat-text-muted))] [&_svg]:size-[15px]">{prompt.icon}</span>
        )}
        <span className="text-[13px] font-medium leading-snug text-[hsl(var(--chat-text))]">
          {prompt.title}
        </span>
        {prompt.subtitle && (
          <span className="text-[11.5px] leading-snug text-[hsl(var(--chat-text-faint))]">
            {prompt.subtitle}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-xl border border-[hsl(var(--chat-border-soft))] bg-[hsl(var(--chat-background))] px-4 py-3 text-left",
        "hover:bg-[hsl(var(--chat-surface))] hover:border-[hsl(var(--chat-border))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]",
        "transition-colors duration-150 ease-out",
        "cursor-pointer",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-3">
        {prompt.icon && (
          <span className="shrink-0 text-[hsl(var(--chat-text-muted))] [&_svg]:size-[15px]">{prompt.icon}</span>
        )}
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[hsl(var(--chat-text))]">
            {prompt.title}
          </span>
          {prompt.subtitle && (
            <span className="mt-0.5 block text-[11.5px] text-[hsl(var(--chat-text-faint))]">
              {prompt.subtitle}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

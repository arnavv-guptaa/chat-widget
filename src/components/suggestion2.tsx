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
            key={index}
            prompt={prompt}
            layout="grid"
            onClick={() => onPromptSelect(prompt)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-3",
        className
      )}
      {...props}
    >
      {prompts.map((prompt, index) => (
        <div key={index}>
          <StarterMessageItem
            prompt={prompt}
            onClick={() => onPromptSelect(prompt)}
          />
          {index < prompts.length - 1 && (
            // 1px-tall element used as a divider — same --chat-divider token
            // every other separator in the widget uses, so consumers only
            // need to override one variable to recolour all of them.
            <div className="h-px mx-3" style={{ backgroundColor: 'var(--chat-divider)' }} />
          )}
        </div>
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
          "border border-[hsl(var(--chat-text)/0.08)]",
          "bg-[hsl(var(--chat-text)/0.02)]",
          "hover:bg-[hsl(var(--chat-text)/0.05)] hover:border-[hsl(var(--chat-text)/0.14)]",
          "transition-colors duration-150 ease-out",
          "cursor-pointer",
          className
        )}
        {...props}
      >
        {prompt.icon && (
          <span className="text-[hsl(var(--chat-text)/0.6)] [&_svg]:size-4">{prompt.icon}</span>
        )}
        <span className="text-[13px] font-medium leading-snug text-[hsl(var(--chat-text)/0.8)]">
          {prompt.title}
        </span>
        {prompt.subtitle && (
          <span className="text-[11px] leading-snug text-[hsl(var(--chat-text)/0.4)]">
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
        "w-full text-left px-3 py-2.5 rounded-lg",
        "bg-transparent",
        "hover:bg-[hsl(var(--chat-text)/0.03)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.25)]",
        "transition-colors duration-150 ease-out",
        "cursor-pointer",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-2">
        {prompt.icon && (
          <span className="shrink-0 text-[hsl(var(--chat-text)/0.5)] [&_svg]:size-4">{prompt.icon}</span>
        )}
        <span className="text-[13px] text-[hsl(var(--chat-text)/0.7)]">
          {prompt.title}
        </span>
      </span>
      {prompt.subtitle && (
        <span className="block text-[11px] text-[hsl(var(--chat-text)/0.4)] mt-0.5">
          {prompt.subtitle}
        </span>
      )}
    </button>
  );
}

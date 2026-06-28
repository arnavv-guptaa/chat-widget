"use client";

import { cn } from "../utils/cn";
import { type HTMLAttributes } from "react";
import type { StarterPrompt } from "../types";

export type { StarterPrompt };

export type StarterMessagesProps = Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
  prompts: StarterPrompt[];
  onPromptSelect: (prompt: StarterPrompt) => void;
};

export function StarterMessages({
  className,
  prompts,
  onPromptSelect,
  ...props
}: StarterMessagesProps) {
  if (prompts.length === 0) return null;

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
};

export function StarterMessageItem({
  className,
  prompt,
  onClick,
  ...props
}: StarterMessageItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      <span className="text-[13px] text-[hsl(var(--chat-text)/0.7)]">
        {prompt.title}
      </span>
      {prompt.subtitle && (
        <span className="block text-[11px] text-[hsl(var(--chat-text)/0.4)] mt-0.5">
          {prompt.subtitle}
        </span>
      )}
    </button>
  );
}

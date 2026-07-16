import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../ui/avatar";
import { cn } from "../utils/cn";
import type { UIMessage } from "ai";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      className
    )}
    {...props}
  />
);

const messageContentVariants = cva(
  // `min-w-0` lets the bubble shrink inside its flex row instead of being forced
  // to its content's intrinsic width; `break-words` wraps long unbreakable
  // tokens (URLs, hashes) rather than overflowing. See styles.src.css for the
  // matching `overflow-wrap: anywhere` rule.
  "flex min-w-0 flex-col gap-2 overflow-hidden break-words leading-relaxed chat-message-content",
  {
    variants: {
      variant: {
        contained: [
          // User messages: compact, high-contrast bubbles on the right. The
          // tighter tail corner and 1.45 line-height match the renderer rhythm
          // without changing the public MessageContent API.
          "group-[.is-user]:max-w-[var(--chat-message-max-width)] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-[5px] group-[.is-user]:px-[15px] group-[.is-user]:py-[9px] group-[.is-user]:text-[14px] group-[.is-user]:leading-[1.45]",
          // Assistant messages: no bubble by default, just text on background.
          "group-[.is-assistant]:max-w-full",
        ],
        flat: [
          "group-[.is-user]:max-w-[var(--chat-message-max-width)] group-[.is-user]:px-[15px] group-[.is-user]:py-[9px] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-[5px] group-[.is-user]:leading-[1.45]",
          "group-[.is-assistant]:max-w-full",
        ],
        surface: [
          "rounded-2xl border px-4 py-3 shadow-sm",
          "border-[hsl(var(--chat-border))] bg-[hsl(var(--chat-surface)/0.64)]",
          "group-[.is-user]:max-w-[var(--chat-message-max-width)] group-[.is-user]:rounded-br-lg",
          "group-[.is-assistant]:max-w-full group-[.is-assistant]:rounded-bl-lg",
        ],
        ghost: [
          "max-w-full",
        ],
      },
      density: {
        compact: "text-[13px] leading-relaxed group-[.is-user]:px-3 group-[.is-user]:py-2",
        balanced: "text-[14px] leading-relaxed",
        spacious: "text-[15px] leading-7 group-[.is-user]:px-5 group-[.is-user]:py-4",
      },
    },
    defaultVariants: {
      variant: "contained",
      density: "balanced",
    },
  }
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof messageContentVariants>;

export const MessageContent = ({
  children,
  className,
  variant,
  density,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(messageContentVariants({ variant, density, className }))}
    {...props}
  >
    {children}
  </div>
);

export type MessageMetadataProps = HTMLAttributes<HTMLDivElement> & {
  items?: ReactNode[];
};

export const MessageMetadata = ({ items, children, className, ...props }: MessageMetadataProps) => {
  const content = children ?? items?.filter(Boolean).map((item, i) => (
    <span className="inline-flex items-center gap-1" key={i}>
      {i > 0 && <span className="text-[hsl(var(--chat-text-subtle))]" aria-hidden="true">·</span>}
      <span>{item}</span>
    </span>
  ));

  if (!content) return null;

  return (
    <div
      className={cn(
        "not-prose mt-2 flex flex-wrap items-center gap-1.5 text-[11px] leading-none text-[hsl(var(--chat-text-muted))]",
        className
      )}
      {...props}
    >
      {content}
    </div>
  );
};

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};

export const MessageAvatar = ({
  src,
  name,
  className,
  ...props
}: MessageAvatarProps) => (
  <Avatar className={cn("size-8 ring-1 ring-border", className)} {...props}>
    <AvatarImage alt="" className="mt-0 mb-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || "ME"}</AvatarFallback>
  </Avatar>
);

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../ui/avatar";
import { cn } from "../utils/cn";
import type { UIMessage } from "ai";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, HTMLAttributes } from "react";

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
          // User messages: compact bubbles on the right (max 85% width)
          "group-[.is-user]:max-w-[var(--chat-message-max-width)] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-lg group-[.is-user]:shadow-sm group-[.is-user]:px-4 group-[.is-user]:py-3",
          // Assistant messages: no bubble, just text on background (max 100% width)
          "group-[.is-assistant]:max-w-full",
        ],
        flat: [
          // User messages: compact on the right
          "group-[.is-user]:max-w-[var(--chat-message-max-width)] group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-lg",
          // Assistant messages: full width
          "group-[.is-assistant]:max-w-full",
        ],
      },
    },
    defaultVariants: {
      variant: "contained",
    },
  }
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof messageContentVariants>;

export const MessageContent = ({
  children,
  className,
  variant,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(messageContentVariants({ variant, className }))}
    {...props}
  >
    {children}
  </div>
);

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

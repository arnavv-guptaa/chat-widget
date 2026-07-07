"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../utils/cn";
import { safeUrl } from "../utils/url-safety";
import { BookIcon, ChevronDownIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose mb-3 text-xs", className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group/source-trigger inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
      "border-[var(--chat-divider)] bg-[hsl(var(--chat-surface)/0.72)] text-[hsl(var(--chat-text-muted))]",
      "hover:bg-[hsl(var(--chat-surface-hover)/0.58)] hover:text-[hsl(var(--chat-text))]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="size-3.5" aria-hidden="true" />
        <span>{count} source{count === 1 ? "" : "s"}</span>
        <ChevronDownIcon
          className="size-3.5 transition-transform group-data-[state=open]/source-trigger:rotate-180"
          aria-hidden="true"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 grid w-full gap-2",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<"a"> & {
  index?: number;
};

function sourceHost(href: SourceProps["href"]): string | undefined {
  if (typeof href !== "string") return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function compactTitle(title: SourceProps["title"], href: SourceProps["href"]): string {
  if (typeof title === "string" && title.trim()) {
    try {
      const url = new URL(title);
      return decodeURIComponent(url.hash?.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || url.hostname);
    } catch {
      return title.trim();
    }
  }
  if (typeof href === "string") {
    try {
      const url = new URL(href);
      return decodeURIComponent(url.hash?.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || url.hostname);
    } catch {
      return href;
    }
  }
  return "Source";
}

export const Source = ({ href, title, children, index, className, ...props }: SourceProps) => {
  // Citation hrefs come from the AI message stream; only allow safe schemes
  // so a javascript:/data: URL cannot execute on click.
  const safeHref = safeUrl(href);
  const host = sourceHost(safeHref);
  const label = compactTitle(title, safeHref);

  const content = children ?? (
    <>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold"
        style={{ borderColor: "var(--chat-divider)", backgroundColor: "hsl(var(--chat-surface))", color: "hsl(var(--chat-text-muted))" }}
        aria-hidden="true"
      >
        {typeof index === "number" ? index + 1 : <FileTextIcon className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[hsl(var(--chat-text))]">
          {label}
        </span>
        {host && (
          <span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--chat-text-muted))]">
            {host}
          </span>
        )}
      </span>
      <ExternalLinkIcon className="size-3.5 shrink-0 text-[hsl(var(--chat-text-subtle))]" aria-hidden="true" />
    </>
  );

  if (!safeHref) {
    return (
      <span
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2",
          "border-[var(--chat-divider)] bg-[hsl(var(--chat-surface)/0.52)]",
          className
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors",
        "border-[var(--chat-divider)] bg-[hsl(var(--chat-surface)/0.52)]",
        "hover:bg-[hsl(var(--chat-surface-hover)/0.48)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]",
        className
      )}
      href={safeHref}
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    >
      {content}
    </a>
  );
};

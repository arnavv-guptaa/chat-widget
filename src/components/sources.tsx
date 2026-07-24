"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../utils/cn";
import { safeUrl } from "../utils/url-safety";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";

export type SourcesProps = ComponentProps<"div">;

/**
 * Sources bibliography footer (#138). Lives BELOW the assistant answer, not
 * above it: the inline citation chips link the prose to these sources, so the
 * list is a reference footer, not a top-of-message callout. Collapsed by
 * default; the trigger is a quiet uppercase section label (see SourcesTrigger).
 * A hairline anchors it to the answer while each source remains an unboxed row.
 */
export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose border-t border-[hsl(var(--chat-hairline))] pt-3 text-xs", className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

/**
 * The bibliography footer affordance: a quiet, left-aligned uppercase label,
 * not a bordered pill. The count remains visible as metadata and the chevron
 * rotates on open; expanded rows stay unnumbered because inline citation chips
 * already carry the numeric mapping.
 */
export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group/source-trigger flex w-full items-center gap-1.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
      "text-[hsl(var(--chat-text-subtle))] hover:text-[hsl(var(--chat-text-muted))]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <span>Sources</span>
        <span className="font-medium normal-case tracking-normal text-[hsl(var(--chat-text-subtle))]">
          {count}
        </span>
        <ChevronDownIcon
          className="size-2.5 transition-transform duration-150 group-data-[state=open]/source-trigger:rotate-180"
          strokeWidth={1.6}
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

/**
 * Resolve a favicon URL for a source host. The host is already rendered in the
 * bibliography row, so requesting its icon leaks nothing the user can't already
 * see. We use Google's S2 favicon endpoint (a long-stable, widely-used service)
 * which serves a single 16–32px PNG per domain; the browser fetches it directly
 * as a normal <img>, no script/credential exchange. Non-http(s) sources (e.g.
 * kb://) return undefined and fall back to the file glyph.
 */
function sourceFaviconUrl(href: SourceProps["href"]): string | undefined {
  if (typeof href !== "string") return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.replace(/^www\./, "");
    if (!host) return undefined;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return undefined;
  }
}

/**
 * The 18px leading slot on a source row. Shows the site favicon when the source
 * is http(s) and the icon loads; falls back to the file glyph on any failure
 * (blocked domain, offline, non-web scheme, network error) so the row never
 * ships a broken-image icon. aria-hidden because the host text beside it already
 * names the source for assistive tech.
 */
function SourceGlyph({ href }: { href: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const faviconUrl = sourceFaviconUrl(href);
  if (!faviconUrl || failed) {
    return (
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[hsl(var(--chat-surface))] text-[hsl(var(--chat-text-faint))]"
        aria-hidden="true"
      >
        <FileTextIcon className="size-3" />
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      src={faviconUrl}
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-[16px] w-[16px] shrink-0 rounded-full bg-[hsl(var(--chat-surface))] object-contain p-[1px]"
    />
  );
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

export const Source = ({ href, title, children, index: _index, className, ...props }: SourceProps) => {
  // Citation hrefs come from the AI message stream; only allow safe schemes
  // so a javascript:/data: URL cannot execute on click.
  const safeHref = safeUrl(href);
  const host = sourceHost(safeHref);
  const label = compactTitle(title, safeHref);

  const content = children ?? (
    <>
      <SourceGlyph href={safeHref} />
      <span className={cn("truncate text-[12.5px] font-medium text-[hsl(var(--chat-text))]", host ? "max-w-[60%]" : "min-w-0 flex-1")}>
        {label}
      </span>
      {host && (
        <>
          <span className="text-[hsl(var(--chat-text-subtle))]" aria-hidden="true">·</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[hsl(var(--chat-text-faint))]">
            {host}
          </span>
        </>
      )}
    </>
  );

  if (!safeHref) {
    return (
      <span
        className={cn(
          "-mx-2 flex w-auto min-w-0 items-center gap-2 rounded-lg px-2 py-1.5",
          "bg-transparent",
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
        "-mx-2 flex w-auto min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        "bg-transparent hover:bg-[hsl(var(--chat-hover-bg))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]",
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

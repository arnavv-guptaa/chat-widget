"use client";

/**
 * CollapsibleCode — a compact renderer for fenced code blocks in assistant
 * messages. OPEN BY DEFAULT with a ~10-line preview: the first lines are
 * visible inline (no click needed to read the code), and anything beyond the
 * cap scrolls inside the body. The header pill (language · N lines · copy)
 * stays, and the chevron collapses the body back to header-only when the user
 * wants it out of the way.
 *
 *     ▾ {} python · 24 lines        [copy]
 *     ┌─────────────────────────────┐
 *     │  line 1                     │
 *     │  line 2                     │  ← first ~10 lines visible
 *     │  …                          │  ← scroll for the rest
 *     └─────────────────────────────┘
 *
 * Inline code (single-backtick) is left untouched — only multi-line fenced
 * blocks render through here.
 *
 * Wired in via Streamdown's `components={{ code: ... }}` override (response.tsx).
 * react-markdown calls the `code` override for BOTH inline and fenced code, so we
 * detect fenced blocks by the `language-*` className (and/or a newline) and pass
 * everything else straight through.
 *
 * Syntax highlighting (Shiki) is a progressive enhancement layered on the body
 * only — the raw `<pre><code>` always renders while (and if ever) highlighting
 * is unavailable. See utils/highlight.ts and the CollapsibleCodeBlock notes
 * below.
 *
 * Design history: an earlier revision was collapsed-by-default (header pill
 * only, body hidden until click). That hid content the reader almost always
 * wants to see and forced an extra click on every block. Open-by-default with a
 * max-height cap is the right call — the cap is what prevents the 80-line wall
 * that collapse-by-default was a workaround for.
 */

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
} from "lucide-react";
import { getFileIconByLanguage } from "./file-icons/file-icon-map";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "../utils/cn";
import { highlightCode } from "../utils/highlight";

/**
 * Language icons come from the shared brand-icon map (ported from jarvis /
 * Crunch): real Python/TypeScript/React/Go glyphs with embedded brand colors —
 * replacing the old lucide "nearest glyph" stand-ins (a feather for Python, a
 * coffee cup for Java) that read as bugs. Unknown tags fall back to a generic
 * file icon — never a crash.
 */
function iconForLanguage(language: string): ComponentType<{ className?: string }> {
  return getFileIconByLanguage(language);
}

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

interface CodeProps {
  className?: string;
  children?: ReactNode;
  // react-markdown passes `inline` on older versions; newer infer from node.
  inline?: boolean;
}

export function CollapsibleCode({ className, children, inline, ...props }: CodeProps) {
  const raw = extractText(children);
  const langMatch = /language-([\w-]+)/.exec(className ?? "");
  const language = langMatch?.[1] ?? "";
  const isFenced = Boolean(language) || raw.includes("\n");

  // Inline code (`foo`) — render as-is; only fenced multi-line blocks use the
  // collapsible renderer.
  if (inline || !isFenced) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return <CollapsibleCodeBlock code={raw.replace(/\n$/, "")} language={language} />;
}

/**
 * How long to wait after the code stops changing before highlighting. While a
 * response streams, `code` grows token-by-token; re-tokenising on every keystroke
 * would jank and waste work on text that's about to change. We debounce so we
 * only ever highlight settled text.
 */
const HIGHLIGHT_DEBOUNCE_MS = 150;

function CollapsibleCodeBlock({ code, language }: { code: string; language: string }) {
  // OPEN BY DEFAULT — the code is visible inline without a click. The body is
  // capped to ~10 lines (see .chat-code-body in styles.src.css) and scrolls for
  // the rest, so a long file no longer dumps an 80-line wall into the chat. The
  // chevron still collapses to header-only if the user wants it out of the way.
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineCount = code.split("\n").length;
  const LanguageIcon = iconForLanguage(language);

  // Monotonic generation counter: each highlight attempt captures the current
  // value and only commits its result if it's still the latest. This drops
  // stale async results from a still-growing stream (an earlier, shorter code
  // string resolving after a later one) and from a collapse-then-reopen.
  const genRef = useRef(0);

  // Highlight the body only when open. Debounced so streaming code is
  // highlighted once it settles, not on every chunk. Any failure (import
  // blocked, unknown lang, oversized) yields null → we keep rendering the plain
  // <pre><code> below. When collapsed, drop highlighted markup so a later reopen
  // re-highlights the (possibly grown) code afresh.
  useEffect(() => {
    if (!open) {
      setHighlighted(null);
      return;
    }

    const gen = ++genRef.current;
    let cancelled = false;
    const timer = setTimeout(() => {
      highlightCode(code, language).then((html) => {
        // Ignore if this effect was cleaned up, or a newer attempt superseded us.
        if (cancelled || gen !== genRef.current) return;
        setHighlighted(html);
      });
    }, HIGHLIGHT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, code, language]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copy = async () => {
    try {
      // Always copy the RAW source — never the highlighted markup.
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable (e.g. http) — ignore */
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="chat-code-collapsible my-2 not-prose">
      <div className="chat-code-header">
        <CollapsibleTrigger className="chat-code-trigger" aria-expanded={open}>
          <ChevronRightIcon
            className={cn("chat-code-chevron size-3.5", open && "chat-code-chevron-open")}
          />
          <LanguageIcon className="chat-code-language-icon size-[13px]" />
          <span className="chat-code-lang">{language || "code"}</span>
          <span className="chat-code-meta">
            · {lineCount} line{lineCount === 1 ? "" : "s"}
          </span>
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={copy}
          className="chat-code-copy"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <CollapsibleContent>
        {highlighted ? (
          // Shiki's <pre class="shiki"> markup. Safe to inject: Shiki escapes all
          // token text as it builds the HTML (tokens are <span>s with
          // text-escaped content), so nothing from `code` can inject markup. The
          // wrapper carries the chat-code-body chrome (padding/border/surface +
          // the ~10-line max-height cap); styles.src.css resets .shiki's own
          // background so the widget surface shows through and the token colours
          // come from --shiki-light/-dark.
          <div
            className="chat-code-body"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          // Plain fallback: the exact pre/code we've always rendered. Shown while
          // highlighting is pending/unavailable and whenever it returns null.
          <pre className="chat-code-body">
            <code>{code}</code>
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

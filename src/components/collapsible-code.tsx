"use client";

/**
 * CollapsibleCode — a compact, collapsed-by-default renderer for fenced code
 * blocks in assistant messages. Instead of dumping an 80-line wall into the chat,
 * it shows a one-line pill:
 *
 *     ▸ {} python · 24 lines        [copy]
 *
 * Click to expand the code inline; click again to collapse. Inline code
 * (single-backtick) is left untouched — only multi-line fenced blocks collapse.
 *
 * Wired in via Streamdown's `components={{ code: ... }}` override (response.tsx).
 * react-markdown calls the `code` override for BOTH inline and fenced code, so we
 * detect fenced blocks by the `language-*` className (and/or a newline) and pass
 * everything else straight through.
 *
 * Syntax highlighting (Shiki) is a progressive enhancement layered on the
 * EXPANDED body only — the collapsed pill stays zero-cost, and the raw
 * `<pre><code>` always renders while (and if ever) highlighting is unavailable.
 * See utils/highlight.ts and the CollapsibleCodeBlock notes below.
 */

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileTypeIcon,
  BracesIcon,
  HashIcon,
  DatabaseIcon,
  GlobeIcon,
  PaletteIcon,
  CoffeeIcon,
  AtomIcon,
  FeatherIcon,
  type LucideProps,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "../utils/cn";
import { highlightCode } from "../utils/highlight";

/**
 * Map a fenced-code language tag to a fitting file icon, so the collapsed pill
 * reads "⌄ 🪶 python · 24 lines" instead of a generic "<>" for everything.
 * Aliases (ts→typescript, py→python, sh→bash, …) collapse to one entry. Anything
 * unknown falls back to a plain code-file icon — never a crash.
 */
const LANGUAGE_ICONS: Record<string, ComponentType<LucideProps>> = {
  // JS / TS family
  javascript: FileCodeIcon, js: FileCodeIcon, jsx: AtomIcon,
  typescript: FileCodeIcon, ts: FileCodeIcon, tsx: AtomIcon,
  // data / config
  json: FileJsonIcon, jsonc: FileJsonIcon, json5: FileJsonIcon,
  yaml: BracesIcon, yml: BracesIcon, toml: BracesIcon,
  // shell
  bash: FileTerminalIcon, sh: FileTerminalIcon, shell: FileTerminalIcon,
  zsh: FileTerminalIcon, console: FileTerminalIcon, powershell: FileTerminalIcon,
  // web
  html: GlobeIcon, xml: GlobeIcon, svg: GlobeIcon,
  css: PaletteIcon, scss: PaletteIcon, sass: PaletteIcon, less: PaletteIcon,
  // db
  sql: DatabaseIcon, postgres: DatabaseIcon, mysql: DatabaseIcon,
  // languages with a closer-fitting glyph
  python: FeatherIcon, py: FeatherIcon,
  ruby: HashIcon, rb: HashIcon,
  java: CoffeeIcon, kotlin: CoffeeIcon,
  markdown: FileTextIcon, md: FileTextIcon, mdx: FileTextIcon, text: FileTextIcon,
  c: FileTypeIcon, cpp: FileTypeIcon, "c++": FileTypeIcon, csharp: FileTypeIcon, "c#": FileTypeIcon,
  go: FileCodeIcon, rust: FileCodeIcon, rs: FileCodeIcon, php: FileCodeIcon,
};

function iconForLanguage(language: string): ComponentType<LucideProps> {
  return LANGUAGE_ICONS[language.toLowerCase()] ?? FileCodeIcon;
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

  // Inline code (`foo`) — render as-is; only fenced multi-line blocks collapse.
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const lineCount = code.split("\n").length;
  const LanguageIcon = iconForLanguage(language);

  // Monotonic generation counter: each highlight attempt captures the current
  // value and only commits its result if it's still the latest. This drops
  // stale async results from a still-growing stream (an earlier, shorter code
  // string resolving after a later one) and from a collapse-then-reopen.
  const genRef = useRef(0);

  // Highlight the EXPANDED body only — the collapsed pill stays free. Debounced
  // so streaming code is highlighted once it settles, not on every chunk. Any
  // failure (import blocked, unknown lang, oversized) yields null → we keep
  // rendering the plain <pre><code> below.
  useEffect(() => {
    if (!open) {
      // Collapsed: drop any highlighted markup so a later reopen re-highlights
      // the (possibly grown) code afresh, and the collapsed state holds nothing.
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

  const copy = async () => {
    try {
      // Always copy the RAW source — never the highlighted markup.
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
          <LanguageIcon className="size-3.5 opacity-70" />
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
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <CollapsibleContent>
        {highlighted ? (
          // Shiki's <pre class="shiki"> markup. Safe to inject: Shiki escapes all
          // token text as it builds the HTML (tokens are <span>s with
          // text-escaped content), so nothing from `code` can inject markup. The
          // wrapper carries the chat-code-body chrome (padding/border/surface);
          // styles.src.css resets .shiki's own background so the widget surface
          // shows through and the token colours come from --shiki-light/-dark.
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

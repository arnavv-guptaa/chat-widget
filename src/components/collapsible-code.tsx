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
 */

import { useState, type ComponentType, type ReactNode } from "react";
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
  if (children && typeof children === "object" && "props" in (children as Record<string, unknown>)) {
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

function CollapsibleCodeBlock({ code, language }: { code: string; language: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineCount = code.split("\n").length;
  const LanguageIcon = iconForLanguage(language);

  const copy = async () => {
    try {
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
        <pre className="chat-code-body">
          <code>{code}</code>
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

"use client";

import { Button } from "../ui/button";
import { cn } from "../utils/cn";
import { highlightCode } from "../utils/highlight";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  /**
   * Optional language hint. Honored when it names a real language; the generic
   * `"json"` default that tool callers pass is treated as "unknown" and verified
   * against the actual content (see `resolveLanguage`). Still surfaced as the
   * `data-language` attribute for styling/selection.
   */
  language?: string;
  /** @deprecated No-op — line numbers are not rendered. */
  showLineNumbers?: boolean;
  children?: ReactNode;
};

/**
 * Resolve the language to highlight as, fixing the substance of #5: tool string
 * output was historically force-highlighted as JSON, so a plain-text / Markdown
 * / error-message result got wrapped in JSON coloring and read as garbled.
 *
 * Rule: honor an explicit, specific `language` — but the `"json"` that every
 * tool call site passes by default is NOT trustworthy (the string may be plain
 * text). For that case (and when no language is given at all) we look at the
 * content: if it `JSON.parse`s, it's genuinely JSON; otherwise it's plain
 * `"text"`. Highlighting itself stays best-effort (unknown langs fall back to
 * plain in the util), so this only needs to get the common case right.
 */
function resolveLanguage(code: string, language: string | undefined): string {
  const hint = (language ?? "").trim().toLowerCase();

  // A specific, non-"json" hint is taken at face value.
  if (hint && hint !== "json") return hint;

  // No hint, or the suspect "json" default → decide from the content itself.
  const trimmed = code.trim();
  if (trimmed) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not JSON — render as plain text rather than mis-coloring it as JSON.
      return "text";
    }
  }
  return "text";
}

/**
 * Code block rendered as a theme-tokened `<pre><code>`, now with Shiki syntax
 * highlighting layered on as a progressive enhancement.
 *
 * History: `react-syntax-highlighter` (Prism) was removed in #177 because its
 * `styles/prism` directory import is invalid under strict native-ESM resolution
 * and crashed consumers (Next RSC / Vite / Turbopack) with
 * ERR_UNSUPPORTED_DIR_IMPORT — leaving this block plain. We reintroduce
 * highlighting the ESM-clean way, via the shared lazy Shiki util
 * (`utils/highlight.ts`): it dynamic-imports `shiki/bundle/web` only when a block
 * actually renders and degrades to this plain `<pre><code>` on ANY failure, so
 * no bundler/runtime can break. Colors come from `--shiki-light/-dark` CSS vars
 * mapped onto the widget theme — consistent with the prose CollapsibleCodeBlock.
 *
 * The public API (`CodeBlock`, `CodeBlockCopyButton`, and every prop including
 * the deprecated `showLineNumbers` no-op) is unchanged — it's part of the
 * exported `Tool` surface.
 */
export const CodeBlock = ({
  code,
  language,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compat
  showLineNumbers: _showLineNumbers,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // The language we actually highlight/label as — resolved from the hint + the
  // content (#5). Recomputed when either changes.
  const resolvedLanguage = resolveLanguage(code, language);

  // Highlight best-effort; null (import blocked, unknown lang, oversized, or a
  // throw) keeps the plain <pre><code> below. Tool payloads are short and not
  // streamed char-by-char here, so no debounce is needed — but we still guard
  // against a stale async result committing after code/language changed.
  useEffect(() => {
    let cancelled = false;
    highlightCode(code, resolvedLanguage).then((html) => {
      if (!cancelled) setHighlighted(html);
    });
    return () => {
      cancelled = true;
    };
  }, [code, resolvedLanguage]);

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-[hsl(var(--chat-text)/0.03)] border border-[hsl(var(--chat-border))]",
          className
        )}
        {...props}
      >
        <div className="relative max-h-96 overflow-y-auto">
          {highlighted ? (
            // Shiki's <pre class="shiki"> markup. Safe to inject: Shiki escapes
            // all token text while building the HTML, so nothing from `code` can
            // inject markup. `.shiki`'s background is reset in styles.src.css so
            // the widget surface shows through; token colors come from the
            // --shiki-light/-dark CSS vars.
            <div
              className="code-block-shiki m-0 overflow-x-auto p-4 font-mono text-sm"
              data-language={resolvedLanguage}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <pre
              className="m-0 overflow-x-auto p-4 font-mono text-sm text-[hsl(var(--chat-text))]"
              data-language={resolvedLanguage}
            >
              <code className="font-mono text-sm">{code}</code>
            </pre>
          )}
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  // Timer id for the "copied" flash, so a rapid re-copy (or unmount) can
  // clear the pending reset instead of leaking it.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyToClipboard = async () => {
    // `navigator.clipboard` is undefined in insecure (http) contexts — common
    // for internal/enterprise deployments. Optional-chain so the guard returns
    // cleanly instead of throwing a TypeError on the property access.
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
};

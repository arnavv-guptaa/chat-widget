"use client";

import { Button } from "../ui/button";
import { cn } from "../utils/cn";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useState } from "react";

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  /**
   * Kept for API compatibility (callers pass e.g. `language="json"`). Rendered
   * as a `data-language` attribute for styling/selection; no syntax-token
   * coloring is applied — see the note below.
   */
  language?: string;
  /** @deprecated No-op — line numbers are not rendered. */
  showLineNumbers?: boolean;
  children?: ReactNode;
};

/**
 * Code block rendered as a plain, theme-tokened `<pre><code>` — deliberately
 * with NO syntax-highlighting library.
 *
 * We removed `react-syntax-highlighter` (and its Prism theme imports): its
 * `styles/prism` directory import is invalid under strict native-ESM resolution
 * and crashed consumers (Next RSC / Vite / Turbopack) with
 * ERR_UNSUPPORTED_DIR_IMPORT. Tool input/output here is short JSON, so plain
 * monospace text — colored via the `--chat-*` theme tokens and consistent with
 * the widget's other code surfaces (CollapsibleCodeBlock) — is the robust,
 * dependency-free choice that works in every bundler/runtime.
 */
export const CodeBlock = ({
  code,
  language,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compat
  showLineNumbers: _showLineNumbers,
  className,
  children,
  ...props
}: CodeBlockProps) => (
  <CodeBlockContext.Provider value={{ code }}>
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[hsl(var(--chat-text)/0.03)] border border-[var(--chat-divider)]",
        className
      )}
      {...props}
    >
      <div className="relative max-h-96 overflow-y-auto">
        <pre
          className="m-0 overflow-x-auto p-4 font-mono text-sm text-[hsl(var(--chat-text))]"
          data-language={language}
        >
          <code className="font-mono text-sm">{code}</code>
        </pre>
        {children && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  </CodeBlockContext.Provider>
);

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
      setTimeout(() => setIsCopied(false), timeout);
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

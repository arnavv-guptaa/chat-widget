"use client";

import { Button } from "../ui/button";
import { cn } from "../utils/cn";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// Import the two Prism themes from their explicit leaf files, NOT the
// `react-syntax-highlighter/dist/esm/styles/prism` directory. A bare directory
// specifier is invalid under strict native-ESM resolution (Next RSC, Vite,
// Turbopack, any `exports`-enforcing resolver) and throws
// ERR_UNSUPPORTED_DIR_IMPORT in consumers — and the barrel's own extensionless
// re-exports (`./coy`, …) are ESM-hostile too. The per-file paths resolve
// cleanly under both CJS and ESM. Ambient types: src/types/rsh-styles.d.ts.
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  children?: ReactNode;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
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
        <SyntaxHighlighter
          className="overflow-hidden dark:hidden"
          codeTagProps={{
            className: "font-mono text-sm",
          }}
          customStyle={{
            margin: 0,
            padding: "1rem",
            fontSize: "0.875rem",
            background: "transparent",
            color: "hsl(var(--chat-text))",
            border: "none",
          }}
          language={language}
          lineNumberStyle={{
            color: "hsl(var(--chat-text) / 0.4)",
            paddingRight: "1rem",
            minWidth: "2.5rem",
          }}
          showLineNumbers={showLineNumbers}
          style={oneLight}
        >
          {code}
        </SyntaxHighlighter>
        <SyntaxHighlighter
          className="hidden overflow-hidden dark:block"
          codeTagProps={{
            className: "font-mono text-sm",
          }}
          customStyle={{
            margin: 0,
            padding: "1rem",
            fontSize: "0.875rem",
            background: "transparent",
            color: "hsl(var(--chat-text))",
            border: "none",
          }}
          language={language}
          lineNumberStyle={{
            color: "hsl(var(--chat-text) / 0.4)",
            paddingRight: "1rem",
            minWidth: "2.5rem",
          }}
          showLineNumbers={showLineNumbers}
          style={oneDark}
        >
          {code}
        </SyntaxHighlighter>
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

"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../utils/cn";
import type { ToolUIPart } from "ai";
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    // `group` is required so the ToolHeader chevron's
    // `group-data-[state=open]:rotate-180` resolves against this collapsible
    // root — without it the expand/collapse caret never rotated.
    className={cn("group not-prose w-full", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"] | "dynamic-tool";
  /**
   * Set when the part is a `dynamic-tool` UIPart (MCP / `dynamicTool()`).
   * For these the `type` is always `"dynamic-tool"`, so the actual tool
   * identity lives in `toolName`. When provided, it wins over the parsed
   * type fragment so the header shows e.g. `get_financials` instead of
   * the generic `tool`.
   */
  toolName?: string;
  state: ToolUIPart["state"];
  className?: string;
};

// AI SDK v6 added approval-requested / approval-responded / output-denied
// to the tool state union. Compact status glyphs keep the exported primitive in
// the same visual language as AgentToolCall — no bordered card, wrench, or badge.
const STATUS_LABELS: Record<ToolUIPart["state"], string> = {
  "input-streaming": "Pending",
  "input-available": "Running",
  "output-available": "Completed",
  "output-error": "Error",
  "approval-requested": "Awaiting approval",
  "approval-responded": "Approved",
  "output-denied": "Denied",
};

const STATUS_ICONS: Record<ToolUIPart["state"], ReactElement> = {
  "input-streaming": <Loader2Icon aria-hidden="true" className="size-3 animate-spin text-[hsl(var(--chat-text-faint))]" />,
  "input-available": <Loader2Icon aria-hidden="true" className="size-3 animate-spin text-[hsl(var(--chat-text-faint))]" />,
  "output-available": <CheckIcon aria-hidden="true" className="size-3 text-[hsl(var(--chat-success))]" strokeWidth={2.5} />,
  "output-error": <XIcon aria-hidden="true" className="size-3 text-[hsl(var(--chat-danger))]" strokeWidth={2.5} />,
  "approval-requested": <ClockIcon aria-hidden="true" className="size-3 text-[hsl(var(--chat-warning))]" />,
  "approval-responded": <CheckIcon aria-hidden="true" className="size-3 text-[hsl(var(--chat-warning))]" strokeWidth={2.5} />,
  "output-denied": <XIcon aria-hidden="true" className="size-3 text-[hsl(var(--chat-text-faint))]" strokeWidth={2.5} />,
};

export const ToolHeader = ({
  className,
  title,
  type,
  toolName,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[hsl(var(--chat-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]",
      className
    )}
    {...props}
  >
    {STATUS_ICONS[state]}
    <span className="sr-only">{STATUS_LABELS[state]}: </span>
    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[hsl(var(--chat-text-muted))]">
      {title ?? toolName ?? type.split("-").slice(1).join("-")}
    </span>
    <ChevronDownIcon aria-hidden="true" className="size-2.5 text-[hsl(var(--chat-text-subtle))] transition-transform duration-150 group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "ml-2 border-l border-[hsl(var(--chat-border-soft))] pl-3 data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-2", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2 p-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

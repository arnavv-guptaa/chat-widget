"use client";

import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../utils/cn";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
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
    className={cn("group not-prose w-full rounded-md border border-[var(--chat-divider)]", className)}
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
// to the tool state union. We map each to a sensible label + icon so
// they don't fall through to undefined.
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
  "input-streaming": <CircleIcon className="size-4" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
  "approval-requested": <ClockIcon className="size-4 text-amber-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-amber-600" />,
  "output-denied": <XCircleIcon className="size-4 text-muted-foreground" />,
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {STATUS_ICONS[status]}
      {STATUS_LABELS[status]}
    </Badge>
  );
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
      "flex w-full items-center justify-between gap-4 p-2",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">
        {title ?? toolName ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
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

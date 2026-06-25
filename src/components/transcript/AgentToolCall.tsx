import { memo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { CodeBlock } from '../code-block';
import { TextShimmer } from './TextShimmer';

/**
 * One assistant tool call, as a single compact row. Reads like "here's what I
 * did for you", not a developer work-log:
 *
 *   ⟳ Pulling up your portfolios …        (running — spinner)
 *   ✓ Pulled up your portfolios   13 results        ⌄   (done — check)
 *   ✕ Couldn't search the web                            (error — cross)
 *
 * - a leading status icon: a small spinner while running, a check once done, a
 *   cross on error — explicit and unambiguous
 * - a friendly verb that shimmers while the tool is running, then settles to
 *   past-tense once it completes
 * - a muted subtitle (the salient input) or, once done, a short result summary
 * - an optional hover-revealed chevron that expands the raw payload inline for
 *   the curious — collapsed by default so the row stays clean.
 *
 * Tokens are --chat-*; no card chrome, just a soft hover surface.
 */
interface AgentToolCallProps {
  verb: string;
  subtitle?: ReactNode;
  isPending: boolean;
  isError: boolean;
  /** Raw payload to reveal on expand (pretty JSON / text). Omitted → no chevron. */
  detail?: string;
  /** Error text shown in red when isError. */
  errorText?: string;
}

const MUTED = { color: 'hsl(var(--chat-text-muted))' } as const;
const SUBTLE = { color: 'hsl(var(--chat-text-subtle))' } as const;
const HOVER = { backgroundColor: 'transparent' } as const;
const SUCCESS_COLOR = { color: 'hsl(var(--chat-text-muted))' } as const;
const ERROR_COLOR = { color: '#ef4444' } as const;

/** Leading status icon: spinner (running) → check (done) → cross (error). */
function StatusIcon({ isPending, isError }: { isPending: boolean; isError: boolean }) {
  if (isError) {
    return <X className="size-3.5 flex-shrink-0" style={ERROR_COLOR} strokeWidth={2.5} aria-hidden="true" />;
  }
  if (isPending) {
    return <Loader2 className="size-3.5 flex-shrink-0 animate-spin" style={SUBTLE} aria-hidden="true" />;
  }
  return <Check className="size-3.5 flex-shrink-0" style={SUCCESS_COLOR} strokeWidth={2.5} aria-hidden="true" />;
}

function AgentToolCallImpl({
  verb,
  subtitle,
  isPending,
  isError,
  detail,
  errorText,
}: AgentToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean((detail && detail.trim()) || errorText);

  return (
    <div className="group/tool select-text">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1 -mx-2 transition-colors',
          hasDetail && 'cursor-pointer hover:bg-[var(--chat-hover-bg)]',
        )}
        style={HOVER}
        onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
      >
        <StatusIcon isPending={isPending} isError={isError} />

        <div className="flex items-baseline gap-1.5 min-w-0 text-[13px] leading-5">
          {isPending ? (
            <TextShimmer as="span" className="font-medium whitespace-nowrap flex-shrink-0">
              {verb}
            </TextShimmer>
          ) : (
            <span className="font-medium whitespace-nowrap flex-shrink-0" style={MUTED}>
              {verb}
            </span>
          )}
          {subtitle && (
            <span className="truncate min-w-0" style={SUBTLE}>
              {subtitle}
            </span>
          )}
        </div>

        {hasDetail && (
          <ChevronRight
            className={cn(
              'ml-auto w-3.5 h-3.5 flex-shrink-0 transition-all duration-200 ease-out',
              expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool:opacity-100',
            )}
            style={SUBTLE}
          />
        )}
      </div>

      {expanded && hasDetail && (
        <div className="chat-tool-detail pl-4 pr-2 pt-1 pb-1">
          {errorText ? (
            <div
              className="rounded-md px-2.5 py-1.5 text-xs"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              {errorText}
            </div>
          ) : (
            <div
              className="rounded-md overflow-auto max-h-56 scrollbar-hide text-xs"
              style={{ backgroundColor: 'hsl(var(--chat-surface))' }}
            >
              <CodeBlock code={detail as string} language="json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const AgentToolCall = memo(
  AgentToolCallImpl,
  (p, n) =>
    p.verb === n.verb &&
    p.subtitle === n.subtitle &&
    p.isPending === n.isPending &&
    p.isError === n.isError &&
    p.detail === n.detail &&
    p.errorText === n.errorText,
);

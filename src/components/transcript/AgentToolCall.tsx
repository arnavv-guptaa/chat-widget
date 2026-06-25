import { memo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { CodeBlock } from '../code-block';
import { TextShimmer } from './TextShimmer';

/**
 * One assistant tool call, as a single compact row. Reads like "here's what I
 * did for you", not a developer work-log:
 *
 *   ● Pulled up your portfolios   13 results        ⌄
 *
 * - a small status dot (pulsing while running, settled when done, red on error)
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
  const dotClass = isError ? 'is-error' : isPending ? 'is-running' : 'is-done';

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
        <span className={cn('chat-status-dot', dotClass)} aria-hidden="true" />

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

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
  /** True when this tool is paused awaiting the end-user's approval. */
  awaitingApproval?: boolean;
  /** Approve (true) / deny (false) the paused tool. */
  onApprove?: (approved: boolean) => void;
}

const MUTED = { color: 'hsl(var(--chat-text-muted))' } as const;
const SUBTLE = { color: 'hsl(var(--chat-text-subtle))' } as const;
const HOVER = { backgroundColor: 'transparent' } as const;
// Match the jarvis PortfolioHoldingsEditor status colours: green-400 / red-400.
const SUCCESS_COLOR = { color: 'hsl(var(--chat-success))' } as const;
const ERROR_COLOR = { color: 'hsl(var(--chat-danger))' } as const;

const APPROVAL_COLOR = { color: 'hsl(var(--chat-warning))' } as const;

/** Leading status icon: amber dot (awaiting approval) → spinner (running) →
 *  green check (done) → red cross (error). */
function StatusIcon({
  isPending,
  isError,
  awaitingApproval,
}: {
  isPending: boolean;
  isError: boolean;
  awaitingApproval?: boolean;
}) {
  if (awaitingApproval) {
    return (
      <span
        className="size-[7px] flex-shrink-0 rounded-full"
        style={{ backgroundColor: APPROVAL_COLOR.color }}
        aria-hidden="true"
      />
    );
  }
  if (isError) {
    return <X className="size-3 flex-shrink-0" style={ERROR_COLOR} strokeWidth={2.5} aria-hidden="true" />;
  }
  if (isPending) {
    return <Loader2 className="size-[11px] flex-shrink-0 animate-spin" style={SUBTLE} aria-hidden="true" />;
  }
  return <Check className="size-3 flex-shrink-0" style={SUCCESS_COLOR} strokeWidth={2.5} aria-hidden="true" />;
}

function AgentToolCallImpl({
  verb,
  subtitle,
  isPending,
  isError,
  detail,
  errorText,
  awaitingApproval,
  onApprove,
}: AgentToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean((detail && detail.trim()) || errorText);
  const accessibleStatus = awaitingApproval
    ? 'Awaiting approval'
    : isError
      ? 'Error'
      : isPending
        ? 'Running'
        : 'Completed';

  return (
    <div
      className={cn(
        'group/tool select-text',
        awaitingApproval &&
          'rounded-[11px] border border-[hsl(var(--chat-warning)/0.28)] bg-[hsl(var(--chat-warning)/0.055)] px-3 py-2.5',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-md py-1 transition-colors',
          !awaitingApproval && '-mx-2 px-2',
          hasDetail &&
            'cursor-pointer hover:bg-[hsl(var(--chat-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]',
        )}
        style={HOVER}
        // Only the rows that actually expand a payload are interactive — expose
        // them as keyboard-operable disclosures; leave static rows as plain text.
        role={hasDetail ? 'button' : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
        onKeyDown={
          hasDetail
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
      >
        {/* Every tool row has a compact status glyph: spinner while running,
            check/cross when settled, warning dot while awaiting approval. */}
        <StatusIcon isPending={isPending} isError={isError} awaitingApproval={awaitingApproval} />
        <span className="sr-only">{accessibleStatus}: </span>

        <div className="flex items-baseline gap-1.5 min-w-0 text-[12.5px] leading-5">
          {isPending ? (
            <TextShimmer as="span" className="font-semibold whitespace-nowrap flex-shrink-0">
              {verb}
            </TextShimmer>
          ) : (
            <span className="font-semibold whitespace-nowrap flex-shrink-0" style={MUTED}>
              {verb}
            </span>
          )}
          {subtitle && (
            awaitingApproval ? (
              <code className="truncate rounded-md bg-[hsl(var(--chat-warning)/0.1)] px-1.5 py-0.5 font-mono text-[11.5px] text-[hsl(var(--chat-text))]">
                {subtitle}
              </code>
            ) : (
              <span className="truncate min-w-0 font-mono text-[11.5px] text-[hsl(var(--chat-text-faint))]">
                {subtitle}
              </span>
            )
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

      {/* Human-in-the-loop: Approve / Deny a paused tool. */}
      {awaitingApproval && onApprove && (
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => onApprove(true)}
            className="chat-tool-approve inline-flex min-h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold"
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => onApprove(false)}
            className="chat-tool-deny inline-flex min-h-8 items-center rounded-lg px-3 text-[12.5px] font-medium"
          >
            Deny
          </button>
        </div>
      )}

      {expanded && hasDetail && (
        <div className="chat-tool-detail pl-4 pr-2 pt-1 pb-1">
          {errorText ? (
            <div
              className="rounded-md px-2.5 py-1.5 text-xs"
              style={{ backgroundColor: 'hsl(var(--chat-danger) / 0.12)', color: 'hsl(var(--chat-danger))' }}
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
    p.errorText === n.errorText &&
    p.awaitingApproval === n.awaitingApproval &&
    p.onApprove === n.onApprove,
);

import { memo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Clock, Loader2, X } from 'lucide-react';
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
const SUCCESS_COLOR = { color: '#4ade80' } as const; // Tailwind green-400
const ERROR_COLOR = { color: '#f87171' } as const; // Tailwind red-400

const APPROVAL_COLOR = { color: '#d97706' } as const; // amber-600

/** Leading status icon: amber clock (awaiting approval) → spinner (running) →
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
    return <Clock className="size-3.5 flex-shrink-0" style={APPROVAL_COLOR} strokeWidth={2.5} aria-hidden="true" />;
  }
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
  awaitingApproval,
  onApprove,
}: AgentToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean((detail && detail.trim()) || errorText);

  return (
    <div className="group/tool select-text">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1 -mx-2 transition-colors',
          hasDetail &&
            'cursor-pointer hover:bg-[var(--chat-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.25)]',
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
        {/* While running, the shimmering text alone signals "in progress" — no
            leading spinner. The status icon still renders for terminal/actionable
            states (done check, error cross, approval clock) where a glyph carries
            meaning the text can't. */}
        {!isPending && (
          <StatusIcon isPending={isPending} isError={isError} awaitingApproval={awaitingApproval} />
        )}

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

      {/* Human-in-the-loop: Approve / Deny a paused tool. */}
      {awaitingApproval && onApprove && (
        <div className="flex items-center gap-2 pl-6 pt-1.5">
          <button
            type="button"
            onClick={() => onApprove(true)}
            className="chat-tool-approve inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
            Approve
          </button>
          <button
            type="button"
            onClick={() => onApprove(false)}
            className="chat-tool-deny inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
          >
            <X className="size-3.5" strokeWidth={2.5} />
            Deny
          </button>
        </div>
      )}

      {expanded && hasDetail && (
        <div className="chat-tool-detail pl-4 pr-2 pt-1 pb-1">
          {errorText ? (
            <div
              className="rounded-md px-2.5 py-1.5 text-xs"
              style={{ backgroundColor: 'rgba(248,113,113,0.12)', color: '#f87171' }}
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

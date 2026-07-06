'use client';

/**
 * ActionResultCard (#166) — a structured, trustworthy summary of what a tool
 * actually did, rendered inline in the message stream instead of as prose or a
 * raw JSON dump.
 *
 * The point is "false-completion" prevention: the agent saying "Done! I updated
 * your settings" while step 4 of 5 silently failed is one of the most
 * trust-destroying patterns in deployed agents. This card reflects the REAL
 * tool outcome — success / partial / error / pending — with the key parameters
 * used and an optional action link, so a user can verify (and the partial/error
 * states are impossible to hide behind confident prose).
 *
 * Theme-aware via the widget's own `--chat-*` tokens; no card chrome beyond a
 * soft bordered surface that matches the rest of the widget.
 */
import { cn } from '../utils/cn';
import { safeUrl } from '../utils/url-safety';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActionResult, ActionResultStatus } from '../types';

type StatusStyle = { Icon: ComponentType<{ className?: string; style?: object; strokeWidth?: number }>; color: string; spin: boolean };

// Status colours mirror AgentToolCall (green-400 / red-400) for visual
// consistency with the default tool row, plus amber for the partial state.
const STATUS_STYLES: Record<ActionResultStatus, StatusStyle> = {
  pending: { Icon: Loader2, color: 'hsl(var(--chat-text-subtle))', spin: true },
  success: { Icon: CheckCircle2, color: '#4ade80', spin: false },
  partial: { Icon: AlertTriangle, color: '#fbbf24', spin: false },
  error: { Icon: XCircle, color: '#f87171', spin: false },
};

export interface ActionResultCardProps extends ActionResult {
  className?: string;
}

export function ActionResultCard({
  status,
  title,
  fields,
  link,
  note,
  className,
}: ActionResultCardProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.success;
  const Icon = s.Icon;
  // `link.href` is host/AI-derived (an `actionRenderer` maps tool output into
  // it), so gate it through the same protocol allowlist as citation links:
  // only a safe scheme renders a real anchor; anything else (javascript:/data:/
  // unknown) degrades to non-clickable text so it can't execute on click.
  const safeHref = link ? safeUrl(link.href) : undefined;

  return (
    <div
      className={cn('not-prose my-1 w-full rounded-xl border px-3 py-2.5', className)}
      style={{ borderColor: 'var(--chat-divider)', backgroundColor: 'hsl(var(--chat-surface) / 0.5)' }}
      role="status"
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn('size-4 flex-shrink-0', s.spin && 'animate-spin')}
          style={{ color: s.color }}
          strokeWidth={2.5}
        />
        <span className="text-[13px] font-semibold" style={{ color: 'hsl(var(--chat-text))' }}>
          {title}
        </span>
      </div>

      {fields && fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-[12px]" style={{ color: 'hsl(var(--chat-text-muted))' }}>
                {f.label}
              </dt>
              <dd className="min-w-0 truncate text-[12px]" style={{ color: 'hsl(var(--chat-text))' }}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {note && (
        <div className="mt-1.5 text-[12px]" style={{ color: 'hsl(var(--chat-text-muted))' }}>
          {note}
        </div>
      )}

      {link &&
        (safeHref ? (
          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex text-[12px] font-medium underline underline-offset-2"
            style={{ color: 'hsl(var(--chat-primary))' }}
          >
            {link.label}
          </a>
        ) : (
          <span
            className="mt-2 inline-flex text-[12px] font-medium"
            style={{ color: 'hsl(var(--chat-text-muted))' }}
          >
            {link.label}
          </span>
        ))}
    </div>
  );
}

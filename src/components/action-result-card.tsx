'use client';

/**
 * ActionResultCard (#166) — a structured, trustworthy summary of what a tool
 * actually did, rendered inline in the message stream instead of as prose or a
 * raw JSON dump.
 */
import { cn } from '../utils/cn';
import { safeUrl } from '../utils/url-safety';
import { AlertTriangle, CheckCircle2, ExternalLinkIcon, Loader2, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActionResult, ActionResultStatus } from '../types';

type StatusStyle = {
  Icon: ComponentType<{ className?: string; style?: object; strokeWidth?: number }>;
  color: string;
  tint: string;
  spin: boolean;
  label: string;
};

const STATUS_STYLES: Record<ActionResultStatus, StatusStyle> = {
  pending: {
    Icon: Loader2,
    color: 'hsl(var(--chat-text-faint))',
    tint: 'hsl(var(--chat-surface))',
    spin: true,
    label: 'Pending',
  },
  success: {
    Icon: CheckCircle2,
    color: 'hsl(var(--chat-success))',
    tint: 'hsl(var(--chat-success) / 0.09)',
    spin: false,
    label: 'Done',
  },
  partial: {
    Icon: AlertTriangle,
    color: 'hsl(var(--chat-warning))',
    tint: 'hsl(var(--chat-warning) / 0.09)',
    spin: false,
    label: 'Partial',
  },
  error: {
    Icon: XCircle,
    color: 'hsl(var(--chat-danger))',
    tint: 'hsl(var(--chat-danger) / 0.09)',
    spin: false,
    label: 'Failed',
  },
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
  const safeHref = link ? safeUrl(link.href) : undefined;

  return (
    <div
      className={cn('not-prose my-[14px] w-full overflow-hidden rounded-[14px] border', className)}
      style={{ borderColor: 'hsl(var(--chat-border-soft))', backgroundColor: 'hsl(var(--chat-background))' }}
      role="status"
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: s.tint }}
          aria-hidden="true"
        >
          <Icon
            className={cn('size-4', s.spin && 'animate-spin')}
            style={{ color: s.color }}
            strokeWidth={2.4}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-semibold" style={{ color: 'hsl(var(--chat-text))' }}>
              {title}
            </span>
            <span
              className="rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em]"
              style={{ borderColor: s.color, color: s.color }}
            >
              {s.label}
            </span>
          </div>

          {note && (
            <div className="mt-1 text-[12px] leading-relaxed" style={{ color: 'hsl(var(--chat-text-muted))' }}>
              {note}
            </div>
          )}

          {fields && fields.length > 0 && (
            <dl className="mt-2 grid gap-1.5">
              {fields.map((f, i) => (
                <div key={i} className="grid min-w-0 grid-cols-[80px_1fr] gap-3 rounded-[7px] px-2 py-1" style={{ backgroundColor: 'hsl(var(--chat-surface))' }}>
                  <dt className="truncate text-[11.5px]" style={{ color: 'hsl(var(--chat-text-faint))' }}>
                    {f.label}
                  </dt>
                  <dd className="min-w-0 truncate font-mono text-[11.5px] font-medium" style={{ color: 'hsl(var(--chat-text))' }}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {link &&
            (safeHref ? (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]"
                style={{ color: 'hsl(var(--chat-primary))' }}
              >
                {link.label}
                <ExternalLinkIcon className="size-3" aria-hidden="true" />
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
      </div>
    </div>
  );
}

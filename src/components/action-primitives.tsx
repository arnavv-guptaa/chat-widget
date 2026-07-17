'use client';

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLinkIcon,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useRef } from 'react';
import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { safeUrl } from '../utils/url-safety';
import { cn } from '../utils/cn';
import type {
  MordnActionConfig,
  MordnActionDispatcher,
  MordnActionPrimitiveProps,
  MordnEntityItem,
  MordnStatusStep,
} from '../actions/types';

function dispatchAction(
  onAction: MordnActionDispatcher | undefined,
  action: MordnActionConfig | undefined,
  source: string,
  values?: Record<string, unknown>,
) {
  if (!onAction || !action) return;
  void onAction({ action, source, values });
}

/**
 * Deterministic hue from a string — gives each entity a stable accent so a
 * card rail reads as a designed set (varied, but anchored to the theme) even
 * when the host supplies no imagery.
 */
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export interface ActionButtonProps
  extends Omit<ComponentProps<'button'>, 'onClick'>,
    MordnActionPrimitiveProps {
  label?: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function ActionButton({
  action,
  onAction,
  disabled,
  loading,
  label,
  icon,
  variant = 'secondary',
  className,
  children,
  ...props
}: ActionButtonProps) {
  const text = label ?? action?.label ?? (typeof children === 'string' ? children : action?.type ?? 'Action');
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' &&
          'border-transparent bg-[hsl(var(--chat-primary))] text-[hsl(var(--chat-background))] hover:brightness-110',
        variant === 'secondary' &&
          'border-[hsl(var(--chat-border))] bg-[hsl(var(--chat-background))] text-[hsl(var(--chat-text))] shadow-sm hover:bg-[hsl(var(--chat-hover-bg))]',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-[hsl(var(--chat-text-muted))] hover:bg-[hsl(var(--chat-text)/0.06)] hover:text-[hsl(var(--chat-text))]',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={() => dispatchAction(onAction, action, 'action-button')}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : icon}
      <span>{children ?? text}</span>
    </button>
  );
}

export interface ActionChipsProps extends ComponentProps<'div'> {
  actions: Array<MordnActionConfig & { label: string }>;
  onAction?: MordnActionDispatcher;
  disabled?: boolean;
}

export function ActionChips({ actions, onAction, disabled, className, ...props }: ActionChipsProps) {
  if (!actions.length) return null;
  return (
    <div className={cn('not-prose flex flex-wrap gap-1.5', className)} {...props}>
      {actions.map((action) => (
        <ActionButton
          key={`${action.type}:${action.label}`}
          action={action}
          onAction={onAction}
          disabled={disabled}
          variant="secondary"
        />
      ))}
    </div>
  );
}

export interface EntityCardProps extends ComponentProps<'article'> {
  item: MordnEntityItem;
  onAction?: MordnActionDispatcher;
}

export function EntityCard({ item, onAction, className, style, ...props }: EntityCardProps) {
  const image = item.imageUrl ? safeUrl(item.imageUrl) : undefined;
  const hue = hashHue(item.id);

  return (
    <article
      className={cn(
        'chat-card-lift not-prose overflow-hidden rounded-2xl border bg-[hsl(var(--chat-background))]',
        className,
      )}
      style={{ borderColor: 'hsl(var(--chat-border))', boxShadow: 'var(--chat-shadow-sm)', ...style }}
      {...props}
    >
      {/* Media header: the host's image when given, otherwise a generated
          accent panel (theme-anchored gradient + oversized glyph) so cards
          never look bare. Badge and price ride on top as glass chips. */}
      <div
        className="relative h-[5.5rem] w-full overflow-hidden"
        style={
          image
            ? undefined
            : {
                background: `linear-gradient(135deg, hsl(var(--chat-primary) / 0.9), hsl(${hue} 58% 48%))`,
              }
        }
      >
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-4 -right-1 select-none text-[72px] font-black leading-none text-white/[0.18]"
            >
              {item.title.slice(0, 1)}
            </span>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.22), transparent 55%)' }}
            />
          </>
        )}
        {item.badge && (
          <span className="absolute left-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {item.badge}
          </span>
        )}
        {item.price && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[12px] font-bold text-gray-900 shadow-sm backdrop-blur-sm">
            {item.price}
          </span>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-[hsl(var(--chat-text))]">{item.title}</h3>
          {item.subtitle && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">
              {item.subtitle}
            </p>
          )}
        </div>

        {item.description && (
          <div className="text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{item.description}</div>
        )}

        {item.attributes && item.attributes.length > 0 && (
          <dl
            className="divide-y overflow-hidden rounded-xl border"
            style={{ borderColor: 'hsl(var(--chat-border) / 0.8)' }}
          >
            {item.attributes.map((attr) => (
              <div
                key={attr.label}
                className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                style={{ borderColor: 'hsl(var(--chat-border) / 0.8)' }}
              >
                <dt className="shrink-0 text-[11px] text-[hsl(var(--chat-text-subtle))]">{attr.label}</dt>
                <dd className="min-w-0 truncate text-right text-[11.5px] font-medium text-[hsl(var(--chat-text))]">
                  {attr.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {item.actions && item.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {item.actions.map((entityAction) => {
              const safeHref = safeUrl(entityAction.href);
              if (safeHref) {
                return (
                  <a
                    key={`${entityAction.label}:${safeHref}`}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium text-[hsl(var(--chat-text))] shadow-sm transition-colors hover:bg-[hsl(var(--chat-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]"
                    style={{ borderColor: 'hsl(var(--chat-border))' }}
                  >
                    {entityAction.label}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                );
              }
              return (
                <ActionButton
                  key={`${entityAction.label}:${entityAction.action?.type ?? 'action'}`}
                  label={entityAction.label}
                  action={entityAction.action}
                  onAction={onAction}
                  variant={entityAction.variant === 'primary' ? 'primary' : entityAction.variant === 'ghost' ? 'ghost' : 'secondary'}
                />
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

export interface EntityCarouselProps extends ComponentProps<'div'> {
  items: MordnEntityItem[];
  onAction?: MordnActionDispatcher;
  label?: string;
}

export function EntityCarousel({ items, onAction, label, className, ...props }: EntityCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  if (!items.length) return null;

  const scrollByCard = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * 276, behavior: 'smooth' });
  };

  return (
    <section className={cn('not-prose space-y-2', className)} aria-label={label} {...props}>
      {(label || items.length > 1) && (
        <div className="flex items-center justify-between gap-2">
          {label && <h3 className="text-[12px] font-semibold text-[hsl(var(--chat-text))]">{label}</h3>}
          {items.length > 1 && (
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Scroll back"
                onClick={() => scrollByCard(-1)}
                className="flex size-6 items-center justify-center rounded-full border text-[hsl(var(--chat-text-muted))] transition-colors hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]"
                style={{ borderColor: 'hsl(var(--chat-border))' }}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Scroll forward"
                onClick={() => scrollByCard(1)}
                className="flex size-6 items-center justify-center rounded-full border text-[hsl(var(--chat-text-muted))] transition-colors hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]"
                style={{ borderColor: 'hsl(var(--chat-border))' }}
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
      <div ref={scrollerRef} className="chat-carousel flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 pr-8">
        {items.map((item, index) => (
          <EntityCard
            key={item.id}
            item={item}
            onAction={onAction}
            className="chat-card-in w-[16.5rem] shrink-0 snap-start"
            style={{ animationDelay: `${Math.min(index, 5) * 70}ms` }}
          />
        ))}
      </div>
    </section>
  );
}

export interface ActionFormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'time' | 'number' | 'textarea';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export interface ActionFormProps extends Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> {
  title?: string;
  description?: string;
  fields: ActionFormField[];
  submitLabel?: string;
  action: MordnActionConfig;
  onAction?: MordnActionDispatcher;
}

export function ActionForm({
  title,
  description,
  fields,
  submitLabel = 'Submit',
  action,
  onAction,
  className,
  ...props
}: ActionFormProps) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    dispatchAction(onAction, action, 'action-form', values);
  }

  return (
    <form
      className={cn(
        'chat-card-in not-prose space-y-3 rounded-2xl border bg-[hsl(var(--chat-background))] p-3.5',
        className,
      )}
      style={{ borderColor: 'hsl(var(--chat-border))', boxShadow: 'var(--chat-shadow-sm)' }}
      onSubmit={onSubmit}
      {...props}
    >
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-[13px] font-semibold text-[hsl(var(--chat-text))]">{title}</h3>}
          {description && <p className="text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{description}</p>}
        </div>
      )}
      <div className="grid gap-2.5">
        {fields.map((field) => {
          const common = {
            id: field.name,
            name: field.name,
            required: field.required,
            placeholder: field.placeholder,
            defaultValue: field.defaultValue,
            className:
              'min-h-9 rounded-xl border bg-[hsl(var(--chat-surface))] px-3 py-1.5 text-[13px] text-[hsl(var(--chat-text))] placeholder:text-[hsl(var(--chat-text-subtle))] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.35)]',
            style: { borderColor: 'hsl(var(--chat-border))' },
          };
          return (
            <label key={field.name} className="grid gap-1 text-[12px] font-medium text-[hsl(var(--chat-text))]" htmlFor={field.name}>
              {field.label}
              {field.type === 'textarea' ? <textarea {...common} rows={3} /> : <input {...common} type={field.type ?? 'text'} />}
            </label>
          );
        })}
      </div>
      <ActionButton action={action} onAction={undefined} variant="primary" type="submit" label={submitLabel}>
        {submitLabel}
      </ActionButton>
    </form>
  );
}

export interface SummaryCardProps extends ComponentProps<'section'> {
  title: string;
  description?: ReactNode;
  rows?: Array<{ label: string; value: ReactNode }>;
  action?: MordnActionConfig;
  onAction?: MordnActionDispatcher;
  actionLabel?: string;
}

/**
 * Receipt-style summary. Rows render as a hairline-divided ledger; a row whose
 * label reads like a grand total ("Total", "Total due"…) is automatically
 * emphasised so the number that matters is the one you see first.
 */
export function SummaryCard({ title, description, rows, action, onAction, actionLabel, className, ...props }: SummaryCardProps) {
  return (
    <section
      className={cn('chat-card-in not-prose overflow-hidden rounded-2xl border bg-[hsl(var(--chat-background))]', className)}
      style={{ borderColor: 'hsl(var(--chat-border))', boxShadow: 'var(--chat-shadow-sm)' }}
      {...props}
    >
      <div className="flex items-start gap-2.5 p-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'hsl(var(--chat-primary) / 0.12)' }}
          aria-hidden="true"
        >
          <CheckCircle2 className="size-4" style={{ color: 'hsl(var(--chat-primary))' }} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-[hsl(var(--chat-text))]">{title}</h3>
          {description && <div className="mt-0.5 text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{description}</div>}
        </div>
      </div>

      {rows && rows.length > 0 && (
        <dl
          className="mx-3 mb-3 divide-y overflow-hidden rounded-xl border"
          style={{ borderColor: 'hsl(var(--chat-border) / 0.8)' }}
        >
          {rows.map((row) => {
            const isTotal = typeof row.label === 'string' && /^total\b/i.test(row.label);
            return (
              <div
                key={row.label}
                className={cn('flex items-baseline justify-between gap-3 px-2.5', isTotal ? 'py-2' : 'py-1.5')}
                style={{
                  borderColor: 'hsl(var(--chat-border) / 0.8)',
                  backgroundColor: isTotal ? 'hsl(var(--chat-primary) / 0.06)' : undefined,
                }}
              >
                <dt className={cn('shrink-0 text-[11px]', isTotal ? 'font-semibold text-[hsl(var(--chat-text))]' : 'text-[hsl(var(--chat-text-subtle))]')}>
                  {row.label}
                </dt>
                <dd className={cn('min-w-0 truncate text-right font-medium text-[hsl(var(--chat-text))]', isTotal ? 'text-[13px] font-bold' : 'text-[11.5px]')}>
                  {row.value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {action && (
        <div className="px-3 pb-3">
          <ActionButton action={action} onAction={onAction} variant="primary" label={actionLabel ?? action.label} />
        </div>
      )}
    </section>
  );
}

export interface ConfirmationCardProps extends ComponentProps<'section'> {
  title: string;
  description?: ReactNode;
  action: MordnActionConfig;
  onAction?: MordnActionDispatcher;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
}

export function ConfirmationCard({
  title,
  description,
  action,
  onAction,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onCancel,
  className,
  ...props
}: ConfirmationCardProps) {
  return (
    <section
      className={cn('chat-card-in not-prose rounded-2xl border bg-[hsl(var(--chat-background))] p-3.5', className)}
      style={{ borderColor: 'hsl(var(--chat-border))', boxShadow: 'var(--chat-shadow-sm)' }}
      {...props}
    >
      <div className="flex gap-2.5">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'hsl(var(--chat-primary) / 0.12)' }}
          aria-hidden="true"
        >
          <ShieldCheck className="size-4" style={{ color: 'hsl(var(--chat-primary))' }} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[hsl(var(--chat-text))]">{title}</h3>
            {description && <div className="mt-1 text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{description}</div>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ActionButton action={action} onAction={onAction} variant="primary" label={confirmLabel}>
              {confirmLabel}
            </ActionButton>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-8 items-center justify-center rounded-full border px-3.5 py-1.5 text-[12px] font-medium text-[hsl(var(--chat-text-muted))] transition-colors hover:bg-[hsl(var(--chat-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]"
              style={{ borderColor: 'hsl(var(--chat-border))' }}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface StatusTrackerProps extends ComponentProps<'ol'> {
  steps: MordnStatusStep[];
}

/**
 * Vertical timeline: success-filled markers for completed steps, a compact
 * spinner on the current one, and a quiet connecting rail for at-a-glance progress.
 */
export function StatusTracker({ steps, className, ...props }: StatusTrackerProps) {
  return (
    <ol
      className={cn('chat-card-in not-prose rounded-[10px] border bg-[hsl(var(--chat-background))] p-3.5', className)}
      style={{ borderColor: 'hsl(var(--chat-border-soft))' }}
      {...props}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const status = step.status ?? 'pending';
        const statusLabel =
          status === 'complete'
            ? 'Completed'
            : status === 'current'
              ? 'In progress'
              : status === 'error'
                ? 'Error'
                : 'Pending';
        return (
          <li key={step.id} className="flex gap-2.5">
            {/* Marker + connecting rail */}
            <span className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                )}
                style={
                  status === 'complete'
                    ? { backgroundColor: 'hsl(var(--chat-success))', borderColor: 'hsl(var(--chat-success))' }
                    : status === 'current'
                      ? { borderColor: 'hsl(var(--chat-text-faint))', borderWidth: 1.5 }
                      : status === 'error'
                        ? { borderColor: 'hsl(var(--chat-danger))', borderWidth: 1.5 }
                        : { borderColor: 'hsl(var(--chat-border-soft))', borderWidth: 1.5 }
                }
              >
                {status === 'complete' && (
                  <Check className="size-2.5" style={{ color: 'hsl(var(--chat-background))' }} strokeWidth={3} />
                )}
                {status === 'current' && (
                  <Loader2 className="size-2.5 animate-spin text-[hsl(var(--chat-text-faint))]" />
                )}
                {status === 'error' && (
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: 'hsl(var(--chat-danger))' }} />
                )}
              </span>
              {!isLast && (
                <span
                  className="w-px flex-1"
                  style={{
                    minHeight: '0.875rem',
                    backgroundColor:
                      status === 'complete' ? 'hsl(var(--chat-success) / 0.45)' : 'hsl(var(--chat-border-soft))',
                  }}
                />
              )}
            </span>

            <span className={cn('min-w-0', !isLast && 'pb-3')}>
              <span
                className={cn(
                  'block text-[13px]',
                  status === 'current' ? 'font-medium text-[hsl(var(--chat-text))]' : 'font-normal',
                  status === 'pending' && 'text-[hsl(var(--chat-text-faint))]',
                  status === 'complete' && 'line-through text-[hsl(var(--chat-text-faint))]',
                  status === 'error' && 'text-[hsl(var(--chat-danger))]',
                )}
              >
                <span className="sr-only">{statusLabel}: </span>
                {step.label}
              </span>
              {step.description && (
                <span className="block text-[11.5px] text-[hsl(var(--chat-text-faint))]">{step.description}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

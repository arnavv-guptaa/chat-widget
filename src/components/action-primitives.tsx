'use client';

import {
  CheckCircle2,
  ChevronRight,
  ExternalLinkIcon,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { safeUrl } from '../utils/url-safety';
import { cn } from '../utils/cn';
import type {
  MordnActionConfig,
  MordnActionDispatcher,
  MordnActionPrimitiveProps,
  MordnEntityItem,
  MordnSelectionOption,
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
        'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' && 'border-transparent bg-[hsl(var(--chat-primary))] text-[hsl(var(--chat-background))] hover:opacity-90',
        variant === 'secondary' && 'border-[var(--chat-divider)] bg-[hsl(var(--chat-surface-deep))] text-[hsl(var(--chat-text))] hover:bg-[hsl(var(--chat-surface-hover))]',
        variant === 'ghost' && 'border-transparent bg-transparent text-[hsl(var(--chat-text-muted))] hover:bg-[hsl(var(--chat-text)/0.06)] hover:text-[hsl(var(--chat-text))]',
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

export function EntityCard({ item, onAction, className, ...props }: EntityCardProps) {
  return (
    <article
      className={cn('not-prose overflow-hidden rounded-2xl border bg-[hsl(var(--chat-surface-deep))]', className)}
      style={{ borderColor: 'var(--chat-divider)' }}
      {...props}
    >
      {item.imageUrl && safeUrl(item.imageUrl) && (
        <img src={safeUrl(item.imageUrl)} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="space-y-3 p-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-[hsl(var(--chat-text))]">{item.title}</h3>
            {item.subtitle && <p className="mt-0.5 text-[12px] text-[hsl(var(--chat-text-muted))]">{item.subtitle}</p>}
          </div>
          {(item.price || item.badge) && (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--chat-text))]" style={{ borderColor: 'var(--chat-divider)' }}>
              {item.price ?? item.badge}
            </span>
          )}
        </div>

        {item.description && <div className="text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{item.description}</div>}

        {item.attributes && item.attributes.length > 0 && (
          <dl className="grid gap-1.5">
            {item.attributes.map((attr) => (
              <div key={attr.label} className="grid grid-cols-[minmax(64px,auto)_1fr] gap-2 rounded-lg bg-[hsl(var(--chat-surface)/0.72)] px-2 py-1">
                <dt className="truncate text-[11px] text-[hsl(var(--chat-text-muted))]">{attr.label}</dt>
                <dd className="min-w-0 truncate text-[11px] font-medium text-[hsl(var(--chat-text))]">{attr.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.actions && item.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.actions.map((entityAction) => {
              const safeHref = safeUrl(entityAction.href);
              if (safeHref) {
                return (
                  <a
                    key={`${entityAction.label}:${safeHref}`}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium text-[hsl(var(--chat-text))] hover:bg-[hsl(var(--chat-surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]"
                    style={{ borderColor: 'var(--chat-divider)' }}
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
  if (!items.length) return null;
  return (
    <section className={cn('not-prose space-y-2', className)} aria-label={label} {...props}>
      {label && <h3 className="text-[12px] font-semibold text-[hsl(var(--chat-text))]">{label}</h3>}
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <EntityCard key={item.id} item={item} onAction={onAction} className="w-[15rem] shrink-0 snap-start" />
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
      className={cn('not-prose space-y-3 rounded-2xl border bg-[hsl(var(--chat-surface-deep))] p-3 shadow-sm', className)}
      style={{ borderColor: 'var(--chat-divider)' }}
      onSubmit={onSubmit}
      {...props}
    >
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-[13px] font-semibold text-[hsl(var(--chat-text))]">{title}</h3>}
          {description && <p className="text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{description}</p>}
        </div>
      )}
      <div className="grid gap-2">
        {fields.map((field) => {
          const common = {
            id: field.name,
            name: field.name,
            required: field.required,
            placeholder: field.placeholder,
            defaultValue: field.defaultValue,
            className:
              'min-h-9 rounded-lg border bg-[hsl(var(--chat-background))] px-2.5 py-1.5 text-[13px] text-[hsl(var(--chat-text))] placeholder:text-[hsl(var(--chat-text-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]',
            style: { borderColor: 'var(--chat-divider)' },
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

export function SummaryCard({ title, description, rows, action, onAction, actionLabel, className, ...props }: SummaryCardProps) {
  return (
    <section className={cn('not-prose rounded-2xl border bg-[hsl(var(--chat-surface-deep))] p-3', className)} style={{ borderColor: 'var(--chat-divider)' }} {...props}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 text-[hsl(var(--chat-primary))]" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[hsl(var(--chat-text))]">{title}</h3>
            {description && <div className="mt-1 text-[12px] leading-relaxed text-[hsl(var(--chat-text-muted))]">{description}</div>}
          </div>
          {rows && rows.length > 0 && (
            <dl className="grid gap-1.5">
              {rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(72px,auto)_1fr] gap-3 rounded-lg bg-[hsl(var(--chat-surface)/0.72)] px-2 py-1">
                  <dt className="truncate text-[11px] text-[hsl(var(--chat-text-muted))]">{row.label}</dt>
                  <dd className="min-w-0 truncate text-[11px] font-medium text-[hsl(var(--chat-text))]">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {action && <ActionButton action={action} onAction={onAction} variant="primary" label={actionLabel ?? action.label} />}
        </div>
      </div>
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
    <section className={cn('not-prose rounded-2xl border bg-[hsl(var(--chat-surface-deep))] p-3', className)} style={{ borderColor: 'var(--chat-divider)' }} {...props}>
      <div className="flex gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[hsl(var(--chat-primary))]" aria-hidden="true" />
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
              className="inline-flex min-h-8 items-center justify-center rounded-full border px-3 py-1.5 text-[12px] font-medium text-[hsl(var(--chat-text-muted))] hover:bg-[hsl(var(--chat-surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-text)/0.22)]"
              style={{ borderColor: 'var(--chat-divider)' }}
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

export function StatusTracker({ steps, className, ...props }: StatusTrackerProps) {
  return (
    <ol className={cn('not-prose grid gap-2 rounded-2xl border bg-[hsl(var(--chat-surface-deep))] p-3', className)} style={{ borderColor: 'var(--chat-divider)' }} {...props}>
      {steps.map((step) => (
        <li key={step.id} className="flex gap-2">
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
              step.status === 'complete' && 'border-transparent bg-[hsl(var(--chat-primary))] text-[hsl(var(--chat-background))]',
              step.status === 'current' && 'border-[hsl(var(--chat-primary))] text-[hsl(var(--chat-primary))]',
              step.status === 'error' && 'border-red-500 text-red-500',
              (!step.status || step.status === 'pending') && 'border-[var(--chat-divider)] text-[hsl(var(--chat-text-muted))]',
            )}
            aria-hidden="true"
          >
            {step.status === 'complete' ? '✓' : <ChevronRight className="size-3" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-[hsl(var(--chat-text))]">{step.label}</span>
            {step.description && <span className="block text-[11px] text-[hsl(var(--chat-text-muted))]">{step.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface SelectionGroupProps extends Omit<ComponentProps<'div'>, 'onSelect'> {
  options: MordnSelectionOption[];
  /** Allow multiple selections (checkbox semantics). Default false (radio). */
  multiple?: boolean;
  label?: string;
  submitLabel?: string;
  action: MordnActionConfig;
  onAction?: MordnActionDispatcher;
}

/**
 * Single- or multi-choice selector (party size, size/color, plan, room type…).
 * Submits the picked value(s) into the action payload under `selected` — a
 * string for single-select, a string[] for multi-select — mirroring how
 * ActionForm folds form values into the dispatch. Fully keyboard-operable via
 * native radio/checkbox inputs; the visual chip is a styled <label>.
 */
export function SelectionGroup({
  options,
  multiple = false,
  label,
  submitLabel = 'Continue',
  action,
  onAction,
  className,
  ...props
}: SelectionGroupProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(value: string) {
    setSelected((prev) => {
      if (multiple) {
        return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      }
      return [value];
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchAction(onAction, action, 'selection-group', {
      selected: multiple ? selected : selected[0],
    });
  }

  const name = `mordn-selection-${action.type}`;
  return (
    <form
      className={cn('not-prose space-y-3 rounded-2xl border bg-[hsl(var(--chat-surface-deep))] p-3', className)}
      style={{ borderColor: 'var(--chat-divider)' }}
      onSubmit={onSubmit}
      {...(props as Omit<ComponentProps<'form'>, 'action' | 'onSubmit'>)}
    >
      {label && (
        <p className="text-[12px] font-medium text-[hsl(var(--chat-text))]" id={`${name}-label`}>
          {label}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={label ? `${name}-label` : undefined}>
        {options.map((option) => {
          const isChecked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              title={option.description}
              className={cn(
                'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-within:ring-2 focus-within:ring-[hsl(var(--chat-text)/0.22)]',
                isChecked
                  ? 'border-transparent bg-[hsl(var(--chat-primary))] text-[hsl(var(--chat-background))]'
                  : 'bg-[hsl(var(--chat-surface-deep))] text-[hsl(var(--chat-text))] hover:bg-[hsl(var(--chat-surface-hover))]',
              )}
              style={isChecked ? undefined : { borderColor: 'var(--chat-divider)' }}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={option.value}
                checked={isChecked}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      <ActionButton action={action} onAction={undefined} variant="primary" type="submit" label={submitLabel} disabled={selected.length === 0}>
        {submitLabel}
      </ActionButton>
    </form>
  );
}

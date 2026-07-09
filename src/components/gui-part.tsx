'use client';

/**
 * MordnGuiPart — the render bridge that turns a serialised {@link MordnGuiSpec}
 * into an interactive primitive INSIDE the chat transcript. This is what gives
 * the chat interface "GUI ability": an assistant streams a small JSON spec (as a
 * tool output or a `data-mordn-ui` data part) and the widget renders the matching
 * #217 primitive — a button, chip row, card, carousel, form, selector, summary,
 * confirmation, or status tracker — wired to the action dispatcher.
 *
 * SECURITY / SAFETY posture (non-negotiable):
 *   • The spec is treated as UNTRUSTED (it originates from the model stream).
 *   • `kind` selects from a CLOSED allowlist mapped to known components. There is
 *     no path from a spec to arbitrary HTML/JSX, `dangerouslySetInnerHTML`, or
 *     `eval`. An unknown `kind` renders nothing (safe fall-through to the default
 *     tool row upstream).
 *   • A malformed / non-object spec renders `null` — it must NEVER throw and
 *     break the transcript (mirrors the defensive parsing in handler.ts).
 *   • Every URL inside the primitives already flows through `safeUrl`.
 *
 * The component is intentionally presentational + a thin validator: all business
 * logic lives in the host's `onAction` dispatcher. Rendering `null` on bad input
 * is the same "degrade cleanly, never crash the chat" contract the rest of the
 * widget follows.
 */

import type { MordnActionConfig, MordnActionDispatcher, MordnGuiSpec, MordnEntityItem } from '../actions/types';
import {
  ActionButton,
  ActionChips,
  ActionForm,
  ConfirmationCard,
  EntityCard,
  EntityCarousel,
  SelectionGroup,
  StatusTracker,
  SummaryCard,
} from './action-primitives';

/** Narrow to a plain object (not null, not array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The set of GUI kinds the built-in renderer understands. */
const KNOWN_GUI_KINDS = new Set<string>([
  'action-button',
  'action-chips',
  'entity-card',
  'entity-carousel',
  'action-form',
  'selection-group',
  'summary-card',
  'confirmation-card',
  'status-tracker',
]);

/**
 * True when `spec` is a plain object whose `kind` the built-in renderer knows.
 * Lets callers decide whether to render a GUI part or fall through to another
 * renderer (e.g. the default tool row) WITHOUT rendering an empty component.
 * Note: a known kind can still fail per-field validation inside MordnGuiPart and
 * render nothing — this is a cheap pre-check, not a full validation.
 */
export function canRenderGui(spec: unknown): boolean {
  return isRecord(spec) && typeof spec.kind === 'string' && KNOWN_GUI_KINDS.has(spec.kind);
}

/** A well-formed action config needs at least a string `type`. */
function isActionConfig(value: unknown): value is MordnActionConfig {
  return isRecord(value) && typeof value.type === 'string' && value.type.length > 0;
}

/**
 * Coerce an untrusted GUI entity item into the ReactNode-typed {@link MordnEntityItem}
 * the primitive expects. Only known string fields survive; anything missing an
 * `id`/`title` is dropped so a malformed item can't render an empty shell.
 */
function toEntityItems(value: unknown): MordnEntityItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MordnEntityItem => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string',
  );
}

export interface MordnGuiPartProps {
  /** The untrusted spec from the assistant stream. */
  spec: unknown;
  /** Dispatcher for any action the rendered primitive emits. */
  onAction?: MordnActionDispatcher;
  /** True while the owning message is still streaming (reserved for future loading UI). */
  isStreaming?: boolean;
}

/**
 * Render a single GUI spec. Returns `null` for anything it can't safely render,
 * so callers can treat `null` as "fall through to the next renderer".
 */
export function MordnGuiPart({ spec, onAction }: MordnGuiPartProps) {
  if (!isRecord(spec) || typeof spec.kind !== 'string') return null;
  const s = spec as MordnGuiSpec;

  switch (s.kind) {
    case 'action-button':
      if (!isActionConfig(s.action)) return null;
      return <ActionButton action={s.action} onAction={onAction} label={s.label} variant={s.variant} />;

    case 'action-chips': {
      const actions = Array.isArray(s.actions)
        ? s.actions.filter((a): a is MordnActionConfig & { label: string } => isActionConfig(a) && typeof a.label === 'string')
        : [];
      if (actions.length === 0) return null;
      return <ActionChips actions={actions} onAction={onAction} />;
    }

    case 'entity-card':
      if (!isRecord(s.item) || typeof s.item.id !== 'string' || typeof s.item.title !== 'string') return null;
      return <EntityCard item={s.item as MordnEntityItem} onAction={onAction} />;

    case 'entity-carousel': {
      const items = toEntityItems(s.items);
      if (items.length === 0) return null;
      return <EntityCarousel items={items} label={s.label} onAction={onAction} />;
    }

    case 'action-form':
      if (!isActionConfig(s.action) || !Array.isArray(s.fields) || s.fields.length === 0) return null;
      return (
        <ActionForm
          title={s.title}
          description={s.description}
          fields={s.fields}
          submitLabel={s.submitLabel}
          action={s.action}
          onAction={onAction}
        />
      );

    case 'selection-group':
      if (!isActionConfig(s.action) || !Array.isArray(s.options) || s.options.length === 0) return null;
      return (
        <SelectionGroup
          options={s.options}
          multiple={s.multiple}
          label={s.label}
          submitLabel={s.submitLabel}
          action={s.action}
          onAction={onAction}
        />
      );

    case 'summary-card':
      if (typeof s.title !== 'string') return null;
      return (
        <SummaryCard
          title={s.title}
          description={s.description}
          rows={s.rows}
          action={isActionConfig(s.action) ? s.action : undefined}
          actionLabel={s.actionLabel}
          onAction={onAction}
        />
      );

    case 'confirmation-card':
      if (typeof s.title !== 'string' || !isActionConfig(s.action)) return null;
      return (
        <ConfirmationCard
          title={s.title}
          description={s.description}
          action={s.action}
          confirmLabel={s.confirmLabel}
          cancelLabel={s.cancelLabel}
          onAction={onAction}
        />
      );

    case 'status-tracker':
      if (!Array.isArray(s.steps) || s.steps.length === 0) return null;
      return <StatusTracker steps={s.steps} />;

    default:
      // Unknown kind → render nothing. New kinds are additive; old widgets
      // simply skip specs they don't understand rather than crashing.
      return null;
  }
}

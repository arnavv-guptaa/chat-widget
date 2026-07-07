/**
 * Open triggers (#193) — lets a *docs site's own chrome* open the widget
 * without the host holding a React ref: a keyboard shortcut, plain
 * `data-mordn-chat-*` attribute buttons (works from static/markdown-generated
 * HTML with zero JS), and a `document` CustomEvent API (the same thing a
 * script-tag embed or a non-React theme would dispatch).
 *
 * Design constraint: none of these routes may fork the open/close logic.
 * They all call the exact same `open` / `close` / `toggle` callbacks the
 * caller passes in — which in `ChatWidget.tsx` are thin wrappers around the
 * single `setOpenState` used by the imperative handle. That keeps the
 * `allowAutoReopen` gate, controlled-mode `onOpenChange` delegation, and
 * `persistState` behaviour identical no matter which door the user walked
 * through.
 *
 * Multi-instance note: if a page mounts more than one `<ChatWidget>`, every
 * instance registers its own listeners here, so a shortcut/button/event
 * fires ALL of them. Acceptable for the target use case (one widget per
 * docs site) — documented on `DisplayConfig.keyboardShortcut` rather than
 * solved with cross-instance coordination.
 */
import { useEffect, useMemo } from 'react';

export interface OpenTriggerActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

interface ParsedShortcut {
  /** `mod` resolved at match-time: metaKey on Mac, ctrlKey elsewhere. */
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-cased non-modifier key, e.g. "k", "/". */
  key: string;
  /** True when the combo has no modifier tokens (e.g. bare "/") — these are
   * suppressed while the user is typing so they don't hijack normal input. */
  bare: boolean;
}

/** Parse a `+`-joined combo string once (memoized by the caller). Returns
 * `null` for `false`/empty/malformed input so the caller can skip attaching
 * a listener rather than throw on a typo'd config value. */
function parseShortcut(combo: string | false | undefined): ParsedShortcut | null {
  if (!combo) return null;
  const tokens = combo
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const parsed: ParsedShortcut = { mod: false, ctrl: false, alt: false, shift: false, key: '', bare: false };
  const keyTokens: string[] = [];
  for (const token of tokens) {
    switch (token) {
      case 'mod':
        parsed.mod = true;
        break;
      case 'ctrl':
      case 'control':
        parsed.ctrl = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      default:
        // Anything not a recognised modifier token is the key. Only the
        // LAST such token counts as the key (e.g. "ctrl+shift+/" → "/");
        // earlier ones are ignored rather than rejecting the whole combo.
        keyTokens.push(token);
    }
  }
  const key = keyTokens[keyTokens.length - 1];
  if (!key) return null; // no key token at all (e.g. "mod+") — malformed, ignore
  parsed.key = key;
  parsed.bare = !parsed.mod && !parsed.ctrl && !parsed.alt && !parsed.shift;
  return parsed;
}

/** Element the user is actively typing into — bare-key shortcuts (no
 * modifier) must not fire while this is true. Modifier combos always fire;
 * an editor that wants to reserve e.g. Cmd+K for itself should stopPropagation
 * on its own listener, same as any other global shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/** Exact modifier-set match (not "at least these") — a combo configured as
 * "mod+k" must NOT fire on "mod+shift+k", so every modifier the event
 * carries has to be accounted for by the parsed combo. */
function matchesShortcut(e: KeyboardEvent, shortcut: ParsedShortcut): boolean {
  // `mod` resolves to metaKey on Mac, ctrlKey elsewhere; it stands in for
  // whichever of ctrlKey/metaKey is the platform's primary modifier, so we
  // don't separately require ctrlKey/metaKey to be unset on the other axis.
  const wantMeta = shortcut.mod && isMac();
  const wantCtrl = shortcut.ctrl || (shortcut.mod && !isMac());
  if (e.metaKey !== wantMeta) return false;
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.altKey !== shortcut.alt) return false;
  if (e.shiftKey !== shortcut.shift) return false;
  return e.key.toLowerCase() === shortcut.key;
}

/**
 * Wires all three open-trigger routes (#193) for one `<ChatWidget>` instance:
 *
 * 1. An optional global keyboard shortcut (`shortcut` — from
 *    `display.keyboardShortcut`). No-op when `shortcut` is `false`/undefined:
 *    nothing is attached, so a widget with no configured shortcut has zero
 *    keydown overhead.
 * 2. A delegated `document` click listener for `data-mordn-chat-open` /
 *    `-toggle` / `-close` — always registered (cheap: one listener, a
 *    `closest()` lookup only on click), so docs themes get button support
 *    for free with no shortcut configured.
 * 3. `document` CustomEvent listeners for `mordn-chat:open` / `:close` /
 *    `:toggle` — always registered, the same routes a script-tag embed or
 *    any other non-React trigger dispatches.
 *
 * All three call back into the SAME `open`/`close`/`toggle` the caller
 * passes — see the module docblock for why that matters.
 */
export function useOpenTriggers(shortcut: string | false | undefined, actions: OpenTriggerActions): void {
  const { open, close, toggle } = actions;
  const parsedShortcut = useMemo(() => parseShortcut(shortcut), [shortcut]);

  // 1. Keyboard shortcut — only attached when configured.
  useEffect(() => {
    if (!parsedShortcut) return;
    if (typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (parsedShortcut.bare && isTypingTarget(e.target)) return;
      if (!matchesShortcut(e, parsedShortcut)) return;
      e.preventDefault();
      toggle();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [parsedShortcut, toggle]);

  // 2. Delegated data-attribute click triggers — always registered (zero-config
  // for docs themes). `closest()` bails out fast when the click didn't land on
  // (or inside) a matching element, so an unconfigured widget still pays for
  // exactly one document listener, no per-render cost.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-mordn-chat-open]')) {
        open();
      } else if (target.closest('[data-mordn-chat-toggle]')) {
        toggle();
      } else if (target.closest('[data-mordn-chat-close]')) {
        close();
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open, close, toggle]);

  // 3. document CustomEvent API — the programmatic equivalent of the
  // data-attribute buttons; also what a script-tag embed dispatches
  // internally to talk to a mounted widget.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleOpen = () => open();
    const handleClose = () => close();
    const handleToggle = () => toggle();

    document.addEventListener('mordn-chat:open', handleOpen);
    document.addEventListener('mordn-chat:close', handleClose);
    document.addEventListener('mordn-chat:toggle', handleToggle);
    return () => {
      document.removeEventListener('mordn-chat:open', handleOpen);
      document.removeEventListener('mordn-chat:close', handleClose);
      document.removeEventListener('mordn-chat:toggle', handleToggle);
    };
  }, [open, close, toggle]);
}

'use client';

/**
 * Portal container for the widget's Radix primitives.
 *
 * Radix Popover/Tooltip/Select/DropdownMenu/Dialog portal their content to
 * `document.body` by default — OUTSIDE the widget's `.chat-widget-container`.
 * Every widget utility class is scoped by `scripts/scope-css.js` to
 * `.chat-widget-container <util>` (a DESCENDANT selector), and the `--chat-*`
 * design tokens + `.dark` overrides are defined only on `.chat-widget-container`.
 * So portalled content rendered on `document.body` matches none of those rules
 * and its tokens are undefined → popovers/menus/tooltips render transparent /
 * unstyled (and never dark) in a host app. It "worked" in our own dashboard only
 * because that page happens to sit inside compatible styling.
 *
 * Fix: mount a body-level `<div class="chat-widget-container [dark]">` that
 * carries the tokens + theme + per-instance overrides, and portal Radix content
 * INTO it. The content is then a descendant of `.chat-widget-container` (scoped
 * utilities match, tokens resolve, dark applies) while still living on
 * `document.body` (so it escapes the widget's own overflow / stacking context —
 * the whole reason Radix portals in the first place).
 *
 * One host element is created per ChatWidget instance, so multiple widgets with
 * different themes on the same page don't collide.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const ChatPortalContainerContext = createContext<HTMLElement | null>(null);

/**
 * The element Radix portals should mount into. `null` until the body-level host
 * is created (SSR / first client render) — callers pass `container ?? undefined`
 * so Radix falls back to its default (`document.body`) in that window.
 */
export function useChatPortalContainer(): HTMLElement | null {
  return useContext(ChatPortalContainerContext);
}

export interface ChatPortalProviderProps {
  /** `''` or `'dark'` — mirrors the widget container's theme class. */
  themeClass?: string;
  /** The widget's `--chat-*` custom-property overrides (from theme props). */
  style?: CSSProperties;
  children: ReactNode;
}

export function ChatPortalProvider({
  themeClass,
  style,
  children,
}: ChatPortalProviderProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  // Create/destroy the body-level host element (client-only; guarded for SSR).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.setAttribute('data-mordn-chat-portal', '');
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
    };
  }, []);

  // Keep the theme class + custom-property overrides in sync with the widget.
  useEffect(() => {
    if (!container) return;
    container.className = `chat-widget-container${themeClass ? ` ${themeClass}` : ''}`;
    // Reset then re-apply so removed overrides don't linger.
    container.removeAttribute('style');
    if (style) {
      for (const [key, value] of Object.entries(style)) {
        if (value != null) container.style.setProperty(key, String(value));
      }
    }
  }, [container, themeClass, style]);

  return (
    <ChatPortalContainerContext.Provider value={container}>
      {children}
    </ChatPortalContainerContext.Provider>
  );
}

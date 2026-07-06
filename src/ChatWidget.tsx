'use client';

/**
 * ChatWidget - Self-contained AI chat widget component
 *
 * This component can be embedded in any React application.
 * It handles its own state, styling, and API communication.
 *
 * Requirements:
 * - API routes must be set up at /api/chat/*
 * - userId must be provided for user identification
 *
 * Usage:
 * ```tsx
 * import { ChatWidget } from '@/components/chat-widget';
 *
 * export default function Page() {
 *   return (
 *     <ChatWidget
 *       userId="user-123"
 *       theme={{ mode: 'dark', primaryColor: '#3b82f6' }}
 *       display={{ size: 'default', resizable: true }}
 *     />
 *   );
 * }
 * ```
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ChatInterface from './components/interface';
import { ChatWidgetConfig, ChatWidgetSize } from './types';
import { MessageCircle, X } from 'lucide-react';
import { ChatStorageProvider } from './contexts/chat-storage-context';
import { ChatPortalProvider } from './contexts/chat-portal-context';
import { toHslTripletIfHex } from './utils/color';

export interface ChatWidgetProps extends ChatWidgetConfig {
  /**
   * CSS class name for custom styling
   */
  className?: string;

  /**
   * Agent ID — identifies which agent this widget talks to. Used to scope the
   * browser cache to (agent, user) so the same browser never surfaces another
   * agent's cached tabs/config, and (later) to load hosted per-agent config.
   */
  agentId?: string;

  /**
   * @deprecated Use `agentId`. Kept as an alias for one minor version.
   */
  widgetId?: string;

  /**
   * Base path the widget calls for chat / upload / history. Defaults to
   * `/api/chat`. Override to mount the handler elsewhere (e.g. a dashboard
   * preview at `/api/preview-chat/<agentId>`). The widget appends `/upload`
   * and `/history` to this base.
   */
  apiBase?: string;

  /**
   * Extra headers sent on every chat request. Used by the dashboard playground
   * to pass an unsaved draft (model / system prompt) for an owner-authed
   * preview. Not for normal embeds.
   */
  extraHeaders?: Record<string, string>;
}

/**
 * Imperative handle exposed via a ref on `<ChatWidget>`. Lets the host app
 * drive the popup panel programmatically. Opening is gated by
 * `allowAutoReopen` (see ChatWidgetConfig) so a dismissed panel is never
 * re-surfaced without explicit opt-in; closing is always allowed. Only
 * meaningful in the `popup` layout (inline/page are always-open surfaces).
 */
export interface ChatWidgetHandle {
  /** Open the panel. No-op unless `allowAutoReopen` is set. */
  open: () => void;
  /** Close the panel. Always allowed. */
  close: () => void;
  /** Toggle the panel. Opening obeys the same `allowAutoReopen` gate as `open()`. */
  toggle: () => void;
  /** Whether the panel is currently open. */
  readonly isOpen: boolean;
}

export const ChatWidget = forwardRef<ChatWidgetHandle, ChatWidgetProps>(function ChatWidget({
  userId,
  agentId,
  apiBase,
  extraHeaders,
  widgetId,
  conversationId,
  initialMessages,
  className,
  model,
  systemPrompt,
  temperature,
  theme,
  features,
  display,
  starterPrompts,
  getStarterPrompts,
  capabilitiesPrompt,
  context,
  onClose,
  headerActions,
  open,
  onOpenChange,
  persistState,
  allowAutoReopen,
  onStateChange,
  inputPlugins,
  toolRenderers,
  actionRenderers,
  followUps,
  feedback,
  onFeedback,
}: ChatWidgetProps, ref) {
  // `agentId` is canonical; `widgetId` is the deprecated alias.
  const effectiveAgentId = agentId ?? widgetId;
  const layout = display?.layout || 'popup';
  // Controlled mode: consumer provides `open` prop. We delegate state to
  // them and skip the built-in FAB so they can render their own trigger.
  const isControlled = open !== undefined;
  const showToggleButton = !isControlled && display?.showToggleButton !== false;
  // Resize only makes sense for the popup layout — inline/page take their
  // size from the parent container.
  const resizable = layout === 'popup' && display?.resizable !== false;
  const size = display?.size || 'default';

  // Persist the panel's open/closed state. Default on; only meaningful for
  // the uncontrolled popup layout (controlled mode → host owns `open`;
  // inline/page are always open).
  const persistEnabled = persistState !== false && !isControlled && layout === 'popup';
  // localStorage key for the panel state, scoped to (agent, user) using the
  // SAME `chat-<prefix>-` convention as the chat cache (chat-storage-context),
  // so clearChatStorage() wipes it on sign-out and distinct identities never
  // collide. `null` when identity is incomplete → we never persist (no
  // shared/static fallback bucket; same cross-user-leak guard as the cache).
  const panelStateKey =
    persistEnabled && userId && effectiveAgentId
      ? `chat-${encodeURIComponent(effectiveAgentId)}|${encodeURIComponent(userId)}-panel-open`
      : null;

  // Open state is meaningful for popup layout only. Inline and page modes
  // are always "open" since they're embedded surfaces, not floating panels.
  // Initialise from `defaultOpen` (SSR-safe — no localStorage read in the
  // initialiser, which would cause a hydration mismatch); reconcile with any
  // persisted preference in the effect below.
  const [internalIsOpen, setInternalIsOpen] = useState(
    layout !== 'popup' ? true : (display?.defaultOpen || false)
  );
  const isOpen = isControlled ? open : internalIsOpen;

  // Hydrate the persisted open/closed preference once the (agent, user) scope
  // is known. A stored 'closed' overrides `defaultOpen` — this is the
  // "dismiss-and-stay-dismissed" guarantee. Client-side only; restoring the
  // saved value is initialisation, so it deliberately does NOT fire
  // onStateChange.
  useEffect(() => {
    if (!panelStateKey) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const stored = window.localStorage.getItem(panelStateKey);
      if (stored === 'open') setInternalIsOpen(true);
      else if (stored === 'closed') setInternalIsOpen(false);
      // stored === null → keep the defaultOpen-derived initial value.
    } catch {
      /* localStorage unavailable (private mode / quota) — ignore. */
    }
  }, [panelStateKey]);

  // Single entry point for changing open state: handles controlled vs
  // uncontrolled, persistence, the onStateChange callback, and the
  // allowAutoReopen gate for programmatic opens.
  const setOpenState = useCallback(
    (next: boolean, opts?: { programmatic?: boolean }) => {
      if (next === isOpen) return; // no-op: nothing changed
      // Gate programmatic *opening* behind allowAutoReopen. User actions
      // (FAB / toggle / close X) pass programmatic:false and are always
      // honoured. Closing is always allowed.
      if (next && opts?.programmatic && !allowAutoReopen) return;
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalIsOpen(next);
        if (panelStateKey && typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(panelStateKey, next ? 'open' : 'closed');
          } catch {
            /* ignore persistence failure */
          }
        }
      }
      onStateChange?.(next);
    },
    [isOpen, allowAutoReopen, isControlled, onOpenChange, onStateChange, panelStateKey]
  );

  // User-driven open/close helper (always allowed). Used by the FAB and the
  // panel's own close button.
  const setIsOpen = useCallback((next: boolean) => setOpenState(next), [setOpenState]);

  // Expose an imperative handle so hosts can drive the panel. Opening is
  // gated by allowAutoReopen; closing and reading are always available.
  useImperativeHandle(
    ref,
    (): ChatWidgetHandle => ({
      open: () => setOpenState(true, { programmatic: true }),
      close: () => setOpenState(false),
      toggle: () => setOpenState(!isOpen, { programmatic: !isOpen }),
      isOpen,
    }),
    [setOpenState, isOpen]
  );
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build CSS custom properties from display + theme config.
  //
  // Theme handling: the widget's CSS expects `--chat-primary`, `--chat-background`
  // and `--chat-text` to be HSL TRIPLETS (e.g. "0 0% 14.5%") because they're
  // consumed inside `hsl(var(--chat-primary))`. Consumers naturally want to
  // pass hex colors though, so we convert when we can detect hex; anything
  // else is forwarded as-is on the assumption the caller knows what they're
  // doing (e.g. they passed an HSL triplet directly).
  const customStyles = useMemo(() => {
    const styles: Record<string, string> = {};

    if (display?.width) {
      styles['--chat-widget-width'] = display.width;
    }

    if (theme?.primaryColor) {
      styles['--chat-primary'] = toHslTripletIfHex(theme.primaryColor);
    }
    if (theme?.backgroundColor) {
      styles['--chat-background'] = toHslTripletIfHex(theme.backgroundColor);
    }
    if (theme?.textColor) {
      styles['--chat-text'] = toHslTripletIfHex(theme.textColor);
    }
    if (theme?.tokens) {
      // Tokens are advanced overrides — pass through unchanged. Caller is
      // responsible for the right format (HSL triplet vs full color value).
      Object.assign(styles, theme.tokens);
    }

    return styles;
  }, [display?.width, theme?.primaryColor, theme?.backgroundColor, theme?.textColor, theme?.tokens]);

  // Handle resize drag - updates CSS variable directly
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [resizable]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      // Calculate new width based on mouse position
      const newWidth = window.innerWidth - e.clientX;

      // Resize constraints (reasonable bounds for any chat widget)
      const minWidth = 300;
      const maxWidth = Math.min(800, window.innerWidth * 0.8);

      // Clamp to constraints
      const clampedWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));

      // Update CSS variable directly on the element
      containerRef.current.style.setProperty('--chat-widget-width', `${clampedWidth}px`);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const config = useMemo(() => ({
    userId,
    apiBase: apiBase ?? '/api/chat',
    extraHeaders,
    model,
    systemPrompt,
    temperature,
    theme,
    features,
    starterPrompts,
    getStarterPrompts,
    capabilitiesPrompt,
    starterPromptsLayout: display?.starterPromptsLayout,
    context,
    inputPlugins,
    toolRenderers,
    actionRenderers,
    followUps,
    feedback,
    onFeedback,
  }), [userId, apiBase, extraHeaders, model, systemPrompt, temperature, theme, features, starterPrompts, getStarterPrompts, capabilitiesPrompt, display?.starterPromptsLayout, context, inputPlugins, toolRenderers, actionRenderers, followUps, feedback, onFeedback]);

  const togglePosition = display?.toggleButtonPosition || { bottom: '24px', right: '24px' };

  // Common interface — same for all three layouts. The wrapper differs.
  const themeClass = theme?.mode === 'dark' ? 'dark' : '';

  // INLINE layout: render the chat interface in place inside the parent. No
  // toggle button, no fixed positioning, no resize. Caller owns sizing via
  // parent CSS (e.g. wrap in a div with h-[600px] w-full).
  if (layout === 'inline') {
    return (
      <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-inline chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={config}
              onClose={onClose}
              headerActions={headerActions}
            />
          </ChatPortalProvider>
        </div>
      </ChatStorageProvider>
    );
  }

  // PAGE layout: full-viewport chat surface. Same internal interface as
  // inline; the difference is only the wrapper CSS class which sets
  // height: 100dvh and provides a dedicated chat route experience.
  if (layout === 'page') {
    return (
      <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-page chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={config}
              onClose={onClose}
              headerActions={headerActions}
            />
          </ChatPortalProvider>
        </div>
      </ChatStorageProvider>
    );
  }

  // POPUP layout (default, backward compatible): floating side panel with
  // FAB toggle and slide-in animation.
  return (
    <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
      {showToggleButton && !isOpen && (
        // Wrap the launcher in a `.chat-widget-container` so its scoped Tailwind
        // utilities (fixed, rounded-full, p-4, bg-primary, …) and the --chat-*
        // tokens resolve. scope-css.js scopes every utility to
        // `.chat-widget-container <util>` (descendant), so a launcher rendered
        // OUTSIDE the container gets none of them — unpositioned and colorless —
        // in a host app. The wrapper is in normal flow with zero footprint; the
        // fixed-position button escapes it.
        <div className={`chat-widget-container ${themeClass}`} style={customStyles as React.CSSProperties}>
          <button
            onClick={() => setIsOpen(true)}
            className="fixed z-50 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-all p-4"
            style={togglePosition}
            aria-label="Open chat"
          >
            <MessageCircle className="h-6 w-6" />
          </button>
        </div>
      )}

      {isOpen && (
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-popup chat-widget-content ${themeClass} ${className || ''}`}
          data-size={size}
          data-resizing={isResizing}
          style={customStyles as React.CSSProperties}
        >
          {resizable && (
            <div
              onMouseDown={handleMouseDown}
              className="chat-widget-resize-handle"
              aria-label="Resize chat widget"
            />
          )}
          <div className="w-full h-full overflow-hidden">
            <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
              <ChatInterface
                id={conversationId}
                initialMessages={initialMessages}
                config={config}
                // popup also closes its own panel; consumer's onClose still
                // fires for any cleanup they want (e.g. analytics).
                onClose={() => {
                  setIsOpen(false);
                  onClose?.();
                }}
                headerActions={headerActions}
              />
            </ChatPortalProvider>
          </div>
        </div>
      )}
    </ChatStorageProvider>
  );
});

// Export ChatWidget as default
export default ChatWidget;

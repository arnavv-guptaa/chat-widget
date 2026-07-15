/**
 * ChatWidget Configuration Types
 *
 * These types define all the configurable options for the ChatWidget component.
 * They match the structure used in the settings panel for easy integration with
 * a hosted service dashboard later.
 */

/**
 * Payload passed to `ChatWidgetProps.onFeedback` when a user rates an
 * assistant message via the thumbs control.
 */
export interface FeedbackEvent {
  /** Id of the assistant message being rated. */
  messageId: string;
  /** Active conversation id, if the conversation has one yet. */
  conversationId?: string;
  /** Thumbs up or down. */
  rating: 'up' | 'down';
  /** Optional freeform reason (thumbs-down); omitted when the user gave none. */
  reason?: string;
}

/**
 * Render function for a tool UI part. Receives the entire part so the
 * renderer can branch on `state` (input-streaming / output-available /
 * output-error) and on the input/output shapes.
 */
export type ToolRenderer = (part: ToolPartLike) => ReactNode | null;

/**
 * Outcome of an action, derived from the REAL tool output (never the model's
 * prose). Drives the card's icon + colour. 'partial' is the critical state for
 * false-completion prevention — the tool ran but didn't fully succeed.
 */
export type ActionResultStatus = 'pending' | 'success' | 'partial' | 'error';

/** One key/value row shown on an action card (e.g. "Assignee" → "@alice"). */
export interface ActionResultField {
  label: string;
  value: ReactNode;
}

/**
 * Structured description of what a tool actually did, rendered as an
 * `ActionResultCard`. Returned by an `ActionRenderer`.
 */
export interface ActionResult {
  /** Real outcome — derive from the tool's output/state, not the model's claim. */
  status: ActionResultStatus;
  /** Headline, e.g. "Ticket created" or "Couldn't update record". */
  title: string;
  /** Key parameters / outcome rows (assignee, priority, id…). */
  fields?: ActionResultField[];
  /** Optional action link, e.g. `{ label: 'View in Linear', href }`. */
  link?: { label: string; href: string };
  /** Optional freeform note or error detail under the fields. */
  note?: ReactNode;
}

/**
 * Maps a tool part to a declarative `ActionResult` (or `null` to fall back to
 * the default tool row). Receives the same loose `ToolPartLike` as
 * `ToolRenderer`, so it can branch on `state`/`output` to report the true
 * outcome.
 */
export type ActionRenderer = (part: ToolPartLike) => ActionResult | null;

/**
 * Simplified message handed to a follow-up generator — no AI SDK types to
 * import. `content` is the concatenated text of the message's text parts.
 */
export interface FollowUpMessage {
  role: string;
  content: string;
}

/**
 * Client-side override/fallback for follow-up chips (#134). Prefer the secure
 * server generator: `createChatHandler({ followUps: true })`.
 */
export interface FollowUpConfig {
  /**
   * Client display switch. Set `false` to hide server-emitted suggestions too.
   * Otherwise server data is shown automatically; `generate` is used only when
   * the response contains no `data-follow-ups` part.
   */
  enabled?: boolean;
  /**
   * BYO client generator fallback. Runs after the assistant reply finishes and
   * never blocks the main response, but provider credentials must stay out of
   * the browser — call your own authenticated backend from here if needed.
   */
  generate?: (messages: FollowUpMessage[]) => string[] | Promise<string[]>;
  /** Max chips to show, clamped to 1–5. Default 3 for client fallbacks. */
  max?: number;
}

/**
 * Loose shape of the tool parts the renderer will receive — covers
 * both static `ToolUIPart<TOOLS>` and the dynamic-tool variant. Kept
 * loose so consumers don't have to import internal AI SDK types.
 */
export interface ToolPartLike {
  /** Either `tool-<name>` or `'dynamic-tool'`. */
  type: string;
  /** Always present on dynamic-tool parts; sometimes absent on static. */
  toolName?: string;
  toolCallId: string;
  /**
   * AI SDK v6 tool lifecycle. The `approval-*` and `output-denied` states cover
   * human-in-the-loop tools (`needsApproval`): the SDK pauses before `execute`
   * and emits `approval-requested`; the UI shows Approve/Deny, the response
   * moves it to `approval-responded`, then `output-available` (ran) or
   * `output-denied` (skipped).
   */
  state:
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied';
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /**
   * Present when `state === 'approval-requested'`: the approval to respond to.
   * `isAutomatic` true means a policy auto-approved it (no user prompt needed).
   */
  approval?: { id: string; isAutomatic?: boolean };
}

/**
 * Item returned by an InputPlugin's fetch function. Renders as one row
 * in the popover.
 */
export interface InputPluginItem {
  /** Stable id, used as the React key + passed back to onSelect. */
  id: string;
  /** Primary line shown in the popover row. */
  label: string;
  /** Optional muted second line (e.g. "8 holdings · USD"). */
  sublabel?: string;
}

/**
 * Definition of a single trigger-driven autocomplete in the chat input.
 */
export interface InputPlugin {
  /**
   * Unique id used for keying / debugging. Not user-visible.
   */
  id: string;
  /**
   * Single character that opens the popover. Must be exactly one
   * character. Common picks: '@', '/', '#'.
   */
  trigger: string;
  /**
   * Optional heading shown above results in the popover (e.g. "Mention",
   * "Commands"). When omitted, no heading.
   */
  heading?: string;
  /**
   * Called with whatever the user has typed AFTER the trigger character
   * (empty string immediately after triggering). Should return the
   * matching items to render. The widget debounces calls; you don't
   * need to.
   */
  fetch: (query: string) => Promise<InputPluginItem[]> | InputPluginItem[];
  /**
   * Called when the user picks an item. Returns the string to splice
   * into the input in place of the trigger + query span. Include any
   * trailing space the input should have after insertion.
   */
  onSelect: (item: InputPluginItem) => string;
  /**
   * Optional empty-state copy when fetch returns zero results.
   * Defaults to "No results".
   */
  emptyText?: string;
}

/**
 * Structured, per-turn context passed from the host app to the model (#162).
 * A plain JSON-serialisable object. Extend it with your own shape via the
 * `context` prop, e.g. `context={{ route: '/billing', plan: 'pro' } satisfies ChatContext}`.
 */
export type ChatContext = Record<string, unknown>;

export interface StarterPrompt {
  /**
   * The main text of the prompt (also used as the message when clicked)
   */
  title: string;

  /**
   * Optional subtitle for additional context
   */
  subtitle?: string;

  /**
   * Optional leading icon (e.g. a lucide icon element). Renders before the
   * title; most impactful in the `grid` starter-prompt layout where chips have
   * room for one.
   */
  icon?: ReactNode;
}

/**
 * Theming is exactly three colors, all required. Every other color in the
 * widget is derived from these (see the ramp in ChatWidget). There is no
 * mode: light vs dark is simply which colors you pick. Omit `theme` entirely
 * to get the stock palette. If any value is not valid hex, the whole theme
 * is ignored — a theme is never half-applied.
 */
export interface ThemeConfig {
  /**
   * Chat background color (hex, e.g. "#171717").
   */
  backgroundColor: string;

  /**
   * Body text color (hex). Must contrast with `backgroundColor` — the widget
   * renders what you declare and does not second-guess it.
   */
  textColor: string;

  /**
   * Primary accent color (hex) — send button, links, focus states.
   */
  primaryColor: string;
}

export interface FeatureConfig {
  /**
   * Enable file uploads. When true, the input toolbar shows a paperclip
   * button and accepts files matching `fileUploadAccept`.
   */
  fileUpload?: boolean;

  /**
   * Comma-separated `accept` filter passed to the file picker when
   * `fileUpload` is true. Mirrors the HTML input[type=file] `accept`
   * syntax (e.g. `"image/*,application/pdf,.csv"`). Defaults to
   * `"image/*"` for backwards compatibility — consumers serving more
   * file types should set this to whatever their server / model
   * actually accepts.
   */
  fileUploadAccept?: string;

  /**
   * Per-file size cap in bytes. The file picker / drag-and-drop
   * surface rejects files above this size before any network call,
   * showing the consumer's onError hook. Should mirror whatever the
   * upload endpoint enforces server-side. When unset, no client-side
   * size check is applied.
   */
  fileUploadMaxBytes?: number;

  /**
   * Enable web search
   */
  webSearch?: boolean;
}

/**
 * Size presets for the chat widget
 * Each preset uses clamp() for responsive sizing:
 * - compact: clamp(300px, 24vw, 400px) - sidebars, minimal footprint
 * - default: clamp(320px, 28vw, 500px) - balanced for most use cases
 * - large: clamp(400px, 35vw, 700px) - content-heavy conversations
 * - full: 100% - fills entire screen
 */
export type ChatWidgetSize = 'compact' | 'default' | 'large' | 'full';

import type { ReactNode } from 'react';

/**
 * Layout shape the widget renders in.
 *
 * - `popup`  : floating side panel, opened by a toggle button (default).
 *              Best for ambient assistance available across pages.
 * - `inline` : renders in place inside the parent element. No toggle button,
 *              no fixed positioning, fills its container. Best for dashboard
 *              cards or dedicated chat sections of a page.
 * - `page`   : full-viewport layout with a conversation list sidebar on the
 *              left and the active chat on the right. Best for a dedicated
 *              chat route (e.g. `/chat`).
 *
 * The `popup` value is the historical default and remains backward compatible.
 */
export type ChatWidgetLayout = 'popup' | 'inline' | 'page';

export interface DisplayConfig {
  /**
   * How the widget renders.
   * Default: `'popup'` (backward compatible).
   */
  layout?: ChatWidgetLayout;

  /**
   * Preset size for the widget (recommended)
   * Uses clamp() for responsive sizing with min/max bounds
   * Default: 'default'
   *
   * Note: `size` only applies in `popup` layout. `inline` and `page` layouts
   * fill their container regardless.
   */
  size?: ChatWidgetSize;

  /**
   * Custom width override (any CSS value)
   * Examples:
   *   - '400px' (fixed)
   *   - '30vw' (viewport-relative)
   *   - 'clamp(300px, 25vw, 500px)' (responsive with bounds)
   * Overrides the size preset if provided
   */
  width?: string;

  /**
   * Enable drag-to-resize functionality
   * Default: true
   */
  resizable?: boolean;

  /**
   * Initial state (open or closed)
   * Default: false
   */
  defaultOpen?: boolean;

  /**
   * How starter prompts are laid out in the empty state.
   * - `'list'` (default): full-width rows, good for descriptive prompts with
   *   subtitles.
   * - `'grid'`: a 2-column chip grid, good for short, scannable prompts
   *   (optionally with an `icon`).
   */
  starterPromptsLayout?: 'list' | 'grid';

  /**
   * Show toggle button to open the chat
   * Default: true
   */
  showToggleButton?: boolean;

  /**
   * Custom toggle button position
   */
  toggleButtonPosition?: {
    bottom?: string;
    right?: string;
  };

  /**
   * Open (toggle) the widget with a keyboard shortcut, so docs sites and
   * dashboards can wire an "Ask AI" affordance into their OWN chrome — nav
   * button, search bar, `/` command — without holding a `ChatWidgetHandle`
   * ref (#193). Also enables two other zero-JS/zero-ref open routes on the
   * same widget instance regardless of this setting: `data-mordn-chat-open`
   * / `-toggle` / `-close` attributes on any element (one delegated document
   * click listener, works from static/markdown-generated HTML), and a
   * `document` CustomEvent API (`mordn-chat:open` / `:close` / `:toggle`) —
   * the same thing a script-tag embed dispatches internally. See the README
   * section "Opening the widget from your site" for copy-pasteable examples
   * of all three.
   *
   * **Format**: a `+`-separated combo of modifier tokens and exactly one
   * key, matched against `KeyboardEvent.key` case-insensitively, e.g.:
   *   - `"mod+k"`       — the primary modifier + K
   *   - `"mod+i"`       — the primary modifier + I
   *   - `"ctrl+shift+/"` — three tokens, last one is the key
   *   - `"/"`           — a single bare key, no modifier
   *
   * `"mod"` resolves at match time to `metaKey` on Mac (Cmd) and `ctrlKey`
   * everywhere else (Ctrl) — the conventional cross-platform "primary
   * modifier" token, same convention as most command-palette libraries.
   * Matching is an EXACT modifier-set match: `"mod+k"` does not also fire on
   * Cmd+Shift+K.
   *
   * **Recommended default for docs sites**: `"mod+i"`. `Cmd/Ctrl+K` has
   * become the de facto convention for "open search" (used by the doc site's
   * own search-bar shortcut in most themes); `Cmd/Ctrl+I` is the emerging
   * convention for "open AI chat" and won't fight the search shortcut for
   * the same key.
   *
   * **Bare keys and typing**: a combo with NO modifier token (e.g. `"/"`)
   * is suppressed while focus is inside an `input`, `textarea`, `select`,
   * or any `contenteditable` element — otherwise every "/" a visitor types
   * into a normal form field would hijack the page. Modifier combos (`"mod+k"`
   * etc.) always fire, typing or not — same behaviour as every command
   * palette (Slack, Linear, Notion, …) a user already expects this from.
   * If your own page also wants a global shortcut on the same key, listen
   * with `capture: true` and call `stopPropagation()`, exactly as you would
   * to resolve a conflict with any other library's global hotkey.
   *
   * **Multi-instance**: if a page mounts more than one `<ChatWidget>`, a
   * matching shortcut/button/event fires ALL of them (no cross-instance
   * coordination) — fine for the common one-widget-per-page case; avoid
   * configuring the same shortcut on multiple simultaneously-mounted
   * instances if you don't want that.
   *
   * Default: `undefined` (off). There is no implicit shortcut — the widget
   * NEVER silently hijacks a host page's keybindings. Set `false` explicitly
   * to make "no shortcut" visible in code/diffs if you want that documented.
   */
  keyboardShortcut?: string | false;
}

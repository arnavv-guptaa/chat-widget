/**
 * ChatWidget Configuration Types
 *
 * These types define all the configurable options for the ChatWidget component.
 * They match the structure used in the settings panel for easy integration with
 * a hosted service dashboard later.
 */

export interface ChatWidgetConfig {
  /**
   * User ID for storing conversations
   * This can be any string identifier from your auth system
   * Required for all widget instances
   */
  userId: string;

  /**
   * `credentials` mode for every request the widget makes (chat stream,
   * history, uploads, feedback). Defaults to the platform default
   * (`same-origin`). Set `'include'` when the widget calls a CROSS-ORIGIN
   * `apiBase` whose `getUserId` reads a session cookie — and pair it with
   * the handler's `cors: { allowOrigins: […], allowCredentials: true }`,
   * since credentialed CORS requires both ends to opt in.
   */
  requestCredentials?: RequestCredentials;

  /**
   * AI Model configuration
   */
  model?: string;

  /**
   * System prompt for the AI
   */
  systemPrompt?: string;

  /**
   * Temperature for AI responses (0-1)
   * 0 = more focused, 1 = more creative
   */
  temperature?: number;

  /**
   * Theme configuration
   */
  theme?: ThemeConfig;

  /**
   * Feature toggles
   */
  features?: FeatureConfig;

  /**
   * Display configuration (popup vs inline, positioning, etc.)
   */
  display?: DisplayConfig;

  /**
   * Initial conversation ID (if loading existing conversation)
   */
  conversationId?: string;

  /**
   * Initial messages (if starting with pre-filled messages)
   */
  initialMessages?: any[];

  /**
   * Starter prompts shown when chat is empty
   * Users can click these to quickly start a conversation
   */
  starterPrompts?: StarterPrompt[];

  /**
   * Dynamic starter prompts resolved at runtime. Use this instead of (or in
   * addition to) the static `starterPrompts` when the right prompts depend on
   * host state — the current route, the resource the user is viewing, their
   * role. Called once when the empty state is first shown; may be async. When
   * it resolves to a non-empty array it takes precedence over `starterPrompts`;
   * errors or empty results fall back to the static list.
   */
  getStarterPrompts?: () => StarterPrompt[] | Promise<StarterPrompt[]>;

  /**
   * Enables the always-available "Not sure where to start?" affordance in the
   * empty state. When set, a small secondary link appears below the starter
   * prompts; clicking it sends this string as the user's message (e.g.
   * "What can you help me with?"), giving users a guaranteed onramp when a
   * blank input offers no direction. Omit to hide the affordance.
   */
  capabilitiesPrompt?: string;

  /**
   * Headline shown in the empty state, above the starter prompts. Omit to fall
   * back to "How can I help?". When neither this nor `subGreeting` is set the
   * greeting block collapses, so existing embeds keep their bare empty state.
   */
  greeting?: string;

  /**
   * Faint line under the greeting headline (e.g. "Your support assistant").
   * Free display text — distinct from `assistantName`, which is identity.
   */
  subGreeting?: string;

  /**
   * The assistant's name (identity). Stored and available to the widget; where
   * it surfaces (header, a11y label, …) is decided separately, so it does not
   * render on its own today.
   */
  assistantName?: string;

  /**
   * First-class per-turn context (#162, #239). Describes the user's live app
   * state — current route, the record they're viewing, their plan/role, etc. —
   * sent alongside every message and folded into the model's system prompt
   * server-side so answers are aware of what the user is actually doing (not
   * just generic Q&A). Accepts three shapes, resolved fresh at SEND TIME (so
   * SPA navigation between messages is reflected):
   *
   * - **object** — a static/updating {@link ChatContext} you assemble yourself,
   *   e.g. `context={{ route: '/billing', plan: 'pro' }}`. Sent as-is.
   * - **`'auto'`** — built-in page capture (#239): the widget snapshots
   *   `{ url, path, title, hash }` from `window.location` / `document` on every
   *   send. One-line page awareness for docs hosts, and the standard shape
   *   #201's ask-about-this-page retrieval bias consumes. SSR-safe: during a
   *   server render there is no page to read, so it contributes `{}` and the
   *   real values are captured on the client at send time. Captures NO identity
   *   data (no cookies, referrer, or user agent) — only the page location.
   * - **function** — `() => ChatContext | Promise<ChatContext>`, called (and
   *   awaited) per send. Use it to compose: spread the auto fields and add your
   *   own, e.g. `context={() => ({ ...buildAutoPageContext(), docsVersion })}`.
   *   If it throws/rejects the turn still sends (context degrades to `{}`); it
   *   never blocks the message.
   *
   * SECURITY (unchanged by `'auto'` / the function form): the browser controls
   * this value, so the server treats it as UNTRUSTED. It is only injected when
   * the handler opts in — either via a server-side `getContext` (authoritative;
   * can validate/merge/override) or `trustClientContext: true`. `'auto'` does
   * NOT make the value trusted; it only saves you from hand-wiring the page
   * fields. Never put secrets here.
   */
  context?: ChatContext | 'auto' | (() => ChatContext | Promise<ChatContext>);

  /**
   * Called when the user dismisses the widget. The widget renders its own
   * close X inside the header (correctly stacked) when this is provided —
   * works in all layouts (popup, inline, page).
   *
   * In `popup` layout the widget also auto-closes its own panel; in
   * `inline` and `page` layouts the consumer owns the close behaviour
   * (e.g. setting their open state, navigating away).
   */
  onClose?: () => void;

  /**
   * Controlled open state for `popup` layout. When provided, the consumer
   * owns the show/hide lifecycle and the widget will NOT render its own
   * floating toggle button (FAB). The consumer renders whatever trigger
   * they want and toggles `open` themselves.
   *
   * Leave undefined to use the widget's built-in uncontrolled behaviour
   * (FAB appears when closed, click opens, internal state).
   */
  open?: boolean;

  /**
   * Called when the widget wants to change its open state (e.g. user
   * clicked the close X). Required when using `open` (controlled mode).
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Persist the popup panel's open/closed state across page navigations and
   * reloads, scoped to (agentId, userId) in localStorage. Once the user
   * explicitly closes the widget it STAYS closed — it is never silently
   * re-opened on the next navigation or session.
   *
   * Only applies to the uncontrolled `popup` layout. Ignored in controlled
   * mode (the host owns `open`) and for `inline` / `page`, which are
   * always-open surfaces. Persistence requires a complete (agentId, userId)
   * identity; with an incomplete identity nothing is written — the same
   * no-shared-bucket rule the chat cache uses.
   *
   * Default: `true`. Set `false` to fall back to `display.defaultOpen` on
   * every mount.
   */
  persistState?: boolean;

  /**
   * Allow the panel to be re-opened programmatically (via the widget ref's
   * `open()` / `toggle()` methods) after the user has explicitly closed it.
   * This is the master switch for any proactive, host-initiated re-open.
   *
   * Default: `false` — once the user dismisses the panel, only their own
   * click on the toggle button reopens it. Set `true` only if your product
   * genuinely needs to surface the assistant unprompted (e.g. a guided
   * onboarding step) and you accept the intrusiveness tradeoff.
   */
  allowAutoReopen?: boolean;

  /**
   * Called whenever the panel's open state changes, with the new value.
   * Fires for user actions and (allowed) programmatic changes, in both
   * controlled and uncontrolled mode. Use it to persist the preference
   * server-side so it survives across browsers / devices — the widget makes
   * no opinionated server call of its own.
   */
  onStateChange?: (open: boolean) => void;

  /**
   * Custom buttons rendered in the widget header next to the close X.
   * Use this for "expand to full page", "settings", or any consumer-defined
   * action that belongs in the widget's chrome — avoids absolute-positioning
   * overlays from the outside that fight the widget's own z-index.
   */
  headerActions?: ReactNode;

  /**
   * Generic in-input autocomplete plugins. Each plugin is triggered by a
   * single character (`@`, `/`, `#`, …); when the user types that
   * character the widget opens a popover, calls `fetch(query)` as they
   * keep typing, renders the returned items, and on selection splices
   * `onSelect(item)` text into the input.
   *
   * The widget knows nothing about the consumer's domain — the host app
   * provides both the data (via `fetch`) and the inserted text shape
   * (via `onSelect`). Add as many plugins as you want; one per trigger
   * character.
   */
  inputPlugins?: InputPlugin[];

  /**
   * Throttle (ms) for UI updates while a response streams. Lower = snappier,
   * more frequent re-renders; higher = fewer re-renders. The widget renders
   * streaming updates in a targeted way (only the active message bubble
   * re-renders per tick), so a low value is safe. Default 50ms (~20Hz).
   * Raise it on low-end devices or for very large tool payloads.
   */
  streamingThrottleMs?: number;

  /**
   * Per-tool custom renderers. When a tool part appears in a message
   * (either a static `tool-<name>` part or a `dynamic-tool` part with
   * `toolName: <name>`), the widget looks up the renderer keyed by tool
   * name and uses it instead of the default JSON-dump tool block.
   *
   * Renderer receives the full tool part and must return a React node.
   * It owns its visual presentation entirely — table, cards, chart,
   * inline summary, whatever fits the data. Return null to fall back
   * to the default rendering (useful for partial-state tool calls
   * where you only want custom rendering once results arrive).
   *
   * The widget knows nothing about specific tools; consumers are
   * responsible for the renderer mapping. This keeps the widget
   * domain-agnostic while letting host apps make tool results feel
   * native.
   */
  toolRenderers?: Record<string, ToolRenderer>;

  /**
   * Declarative action-result cards (#166). Map a tool name to a structured
   * result — `{ status, title, fields, link }` — derived from the tool's REAL
   * output, rendered as a polished `ActionResultCard`. This is the
   * "false-completion" guard: the card shows what actually happened (success /
   * partial / error), not the model's prose claim that it "did" something.
   *
   * Precedence: `toolRenderers` (full custom JSX) wins first; then
   * `actionRenderers` (this declarative card); then the default compact tool
   * row. Return `null` to fall through to the next.
   */
  actionRenderers?: Record<string, ActionRenderer>;

  /**
   * Optional client-side override/fallback for follow-up chips shown after an
   * assistant reply (#134). The recommended path is server-side
   * `createChatHandler({ followUps: true })`, which emits a safe
   * `data-follow-ups` part in the response stream automatically — no browser
   * API key or client generator required. Use this object only to force-hide
   * server suggestions or supply a custom client-side generator for a BYO
   * transport.
   */
  followUps?: FollowUpConfig;

  /**
   * Show a thumbs up / thumbs down control under each completed ASSISTANT
   * message so end users can rate answer quality. Opt-in — omit or set `false`
   * to hide the control entirely (default). When enabled, clicking a thumb
   * records the rating to the hosted backend (`POST ${apiBase}/v1/feedback`,
   * reusing the widget's existing transport headers — best-effort, never
   * blocks or errors the chat) AND fires `onFeedback`. Thumbs-down reveals an
   * optional inline reason box; submitting with or without a reason works.
   *
   * Degrades cleanly: with no hosted base URL (headless render / BYO backend)
   * the network call is skipped and only `onFeedback` fires. Existing behaviour
   * is untouched when this is off.
   */
  feedback?: boolean;

  /**
   * Fired on every feedback submission (thumbs up or down), whether or not the
   * backend POST succeeds — so hosts can wire their own analytics / storage
   * even in BYO / headless mode where there is no hosted feedback endpoint.
   *
   * `conversationId` is the active conversation (may be undefined for a brand-new
   * chat not yet persisted); `messageId` identifies the rated assistant message;
   * `reason` is present only when the user typed one (thumbs-down).
   */
  onFeedback?: (feedback: FeedbackEvent) => void;
}

/**
 * Payload passed to {@link ChatWidgetConfig.onFeedback} when a user rates an
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

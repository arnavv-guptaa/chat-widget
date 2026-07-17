'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './conversation';
import { Message, MessageContent } from './message';
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInputAttachments,
} from './prompt-input';
import {
  Actions,
  Action,
} from './actions';
import { MessageAttachments } from './message-attachments';
import { useInputPlugins } from './input-plugin-popover';
import { ChatErrorBanner } from './chat-error-banner';
import { MessageActions } from './message-actions';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { HistoryIcon, MessageSquareIcon, SearchIcon, PaperclipIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { normalizeFollowUpSuggestions, resolveFollowUpCount } from '../utils/follow-ups';
import {
  hasRenderableAssistantContent,
  messagesForTranscript,
} from '../utils/assistant-content';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Fragment } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { Response } from './response';
import { GlobeIcon, RefreshCcwIcon, CopyIcon } from 'lucide-react';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from './sources';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from './reasoning';
import { Loader } from './loader';
import { TextShimmer } from './transcript/TextShimmer';
import { pickPlanningVerb } from './transcript/toolRegistry';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from './tool';
import { FollowUpSuggestions } from './follow-up-suggestions';
import { StarterMessages } from './suggestion2';
import { MessageItem } from './message-item';
import { useChatStorageKey } from '../contexts/chat-storage-context';
import type { StarterPrompt, FollowUpMessage } from '../types';

type Conversation = {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  metadata?: any;
};

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  if (diffHours < 7 * 24) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Storage access that can never throw. Safari private mode (historically a
 * QuotaExceededError on ANY setItem), storage disabled by policy, a full
 * origin quota, or SSR must all degrade to "no persistence" — never to a
 * crashed widget inside someone else's app. Every other file already guards
 * its storage access; interface.tsx was the lone gap and holds the most
 * storage code, so the guard lives here as one helper instead of ad-hoc
 * try/catch at every call site.
 */
const makeSafeStorage = (resolve: () => Storage) => ({
  get(key: string): string | null {
    try {
      return resolve().getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      resolve().setItem(key, value);
    } catch {
      /* persistence is best-effort */
    }
  },
  remove(key: string): void {
    try {
      resolve().removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(): string[] {
    try {
      const store = resolve();
      const out: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
});

const safeStorage = makeSafeStorage(() => window.localStorage);
// Drafts live in sessionStorage on purpose: a half-typed message should
// survive tab switches and panel close/reopen within the visit, but is not
// worth carrying across browser sessions the way conversation tabs are.
const safeSession = makeSafeStorage(() => window.sessionStorage);

type ChatTab = {
  id: string;
  title: string;
  isActive: boolean;
};

/**
 * Attachment button — compact ghost icon on the left of the prompt row, sized
 * to match the send button with a muted paperclip that doesn't
 * compete with the text or the send action. Reads the attachments context.
 *
 * Hoisted to MODULE scope deliberately: it used to be defined inside
 * ChatInterface's render, which makes React see a brand-new component type
 * every render — unmounting and remounting the subtree each time (transient
 * state/focus loss + wasted work). A component must never be defined inside
 * another component's body.
 */
function AttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      variant="ghost"
      size="icon"
      // Quiet icon button: faint at rest, then the shared hover surface and
      // full text color on interaction.
      className="size-8 rounded-[7px] text-[hsl(var(--chat-text-faint))] hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))]"
      aria-label="Attach files"
      onClick={() => attachments.openFileDialog()}
    >
      {/* lucide's Paperclip runs bottom-left→top-right; rotate -45° to
          stand it upright (vertical). */}
      <PaperclipIcon className="size-4 -rotate-45" />
    </PromptInputButton>
  );
}

export default function ChatInterface({ id, initialMessages, config, onClose, headerActions }: { id?: string; initialMessages?: any[]; config?: any; onClose?: () => void; headerActions?: React.ReactNode } = {}) {
  // Storage key prefix is scoped to (agent, user). It is `null` when identity
  // is incomplete — in that case storageKey() returns null and every caller
  // must skip persistence (no shared/static fallback bucket → no cross-user leak).
  const { storageKeyPrefix } = useChatStorageKey();
  const storageKey = (key: string): string | null =>
    storageKeyPrefix ? `chat-${storageKeyPrefix}-${key}` : null;

  // Base path for every widget request, normalised ONCE: a trailing slash on
  // the configured apiBase (an easy config typo, especially for cross-origin
  // embeds) would otherwise produce double-slash URLs (`…/api/chat//upload`)
  // that literal-matching routers and proxies 404. feedback.ts already guards
  // this on its own path — this brings the other five call sites in line.
  // A bare '/' (root mount) strips to '' so `${apiBase}/history` stays a
  // proper root-relative path instead of a scheme-relative '//history'.
  const apiBase = String(config?.apiBase ?? '/api/chat').replace(/\/+$/, '');

  // Per-tab composer drafts (sessionStorage — see safeSession above). Scoped
  // exactly like every other persisted key; null when identity is incomplete,
  // in which case drafts simply don't persist.
  const draftKey = (tabId: string): string | null =>
    storageKeyPrefix && tabId ? `chat-${storageKeyPrefix}-draft-${tabId}` : null;

  // Get theme mode from config (defaults to 'light')

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputPlugins = useInputPlugins({
    textareaRef: inputRef,
    value: input,
    setValue: setInput,
    plugins: config?.inputPlugins,
  });
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Dynamic starter prompts (#164). Resolved once when first needed; falls
  // back to the static config.starterPrompts on empty result or error. The
  // one-shot ref guards against re-resolving if the host passes an inline
  // (non-memoised) getStarterPrompts.
  const [dynamicPrompts, setDynamicPrompts] = useState<StarterPrompt[] | null>(null);
  const dynamicPromptsResolved = useRef(false);
  useEffect(() => {
    if (dynamicPromptsResolved.current) return;
    const getPrompts = config?.getStarterPrompts;
    if (typeof getPrompts !== 'function') return;
    dynamicPromptsResolved.current = true;
    let cancelled = false;
    Promise.resolve()
      .then(() => getPrompts())
      .then((p: StarterPrompt[]) => {
        if (!cancelled && Array.isArray(p) && p.length > 0) setDynamicPrompts(p);
      })
      .catch(() => {
        /* fall back to static starterPrompts */
      });
    return () => {
      cancelled = true;
    };
  }, [config?.getStarterPrompts]);

  // Dynamic prompts win when present; otherwise the static list.
  const effectiveStarterPrompts: StarterPrompt[] | undefined =
    (dynamicPrompts && dynamicPrompts.length > 0 ? dynamicPrompts : config?.starterPrompts) ?? undefined;

  // AI follow-up chips (#134). The preferred path is a server-emitted
  // `data-follow-ups` part on the completed assistant message; the legacy
  // client generator/static config remains as an override/fallback.
  const [followUps, setFollowUps] = useState<string[]>([]);
  const followUpsForRef = useRef<string | null>(null);

  // Auto-dismiss upload errors after 5 seconds
  useEffect(() => {
    if (uploadError) {
      const timeoutId = setTimeout(() => setUploadError(null), 5000);
      return () => clearTimeout(timeoutId);
    }
  }, [uploadError]);

  // Tab management
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [initialTabCreated, setInitialTabCreated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  // True while switching tabs and the new tab's messages are mid-fetch.
  // Distinct from isInitializing (which only covers first mount) so the
  // empty-state gate stays closed during tab switches too.
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // ── History lazy-loading (reverse pagination) ───────────────────────────────
  // We load the most-recent page on open and fetch older pages when the user
  // scrolls near the top. `hasMoreHistory` gates further fetches; `oldestTs` is
  // the `before` cursor for the next page; the ref guards against concurrent /
  // duplicate fetches. PAGE_SIZE is the per-request count.
  const HISTORY_PAGE_SIZE = 30;
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldestTsRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  // Track last synced tab to prevent infinite loops
  const lastSyncedTabId = useRef<string>('');

  // Ref-based initialization guard to ensure initialization runs only once
  const hasInitialized = useRef(false);

  // Live mirrors for values that async callbacks must read FRESH. A callback
  // that awaited a fetch would otherwise act on the state it closed over at
  // call time — exactly the stale view that lets one tab's response land in
  // another tab. `activeTabIdRef` is written synchronously at every activation
  // site (not in an effect) so even an await that resolves between commits
  // sees the truth; `statusRef` mirrors the stream status for callbacks whose
  // dep arrays would otherwise go stale (e.g. createNewTab).
  const activeTabIdRef = useRef<string>('');
  const statusRef = useRef<string>('ready');
  // Monotonic generation for conversation loads: a resolved fetch applies only
  // if it is still the LATEST load AND its conversation is still active.
  // Guards the tab-switch race (slow tab-A fetch resolving after tab B was
  // activated) without threading AbortControllers through every path.
  const loadGenRef = useRef(0);

  // Mounted flag for async flows (uploads, history fetches) whose resolutions
  // can outlive the component — e.g. the popup unmounts this whole tree on
  // close while an upload is mid-flight. NOTE: (re)set in the effect BODY, not
  // the ref initialiser — React 18 StrictMode runs mount → cleanup → mount,
  // and an initialiser-only flag would stay false after the second mount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `initialMessages` (public prop, previously accepted-but-ignored): the
  // seed transcript for conversations that don't exist server-side yet — a
  // welcome exchange, an SSR-prepared transcript. Captured ONCE by contract
  // ("initial"); reacting to later mutations would fight the server as the
  // source of truth once a conversation persists.
  const initialMessagesRef = useRef<any[] | undefined>(initialMessages);

  // First-class per-turn context (#162). Held in a ref so the transport's
  // prepareSendMessagesRequest always reads the latest value without
  // re-creating the chat (and resetting the stream) on every context change.
  const contextRef = useRef<unknown>(config?.context);
  useEffect(() => {
    contextRef.current = config?.context;
  }, [config?.context]);

  // Request headers, same ref pattern as context above: the transport captures
  // its options once, so a plain object here freezes whatever extraHeaders held
  // at mount. Hosts that change headers per render (the playground sends its
  // UNSAVED draft toggles this way, e.g. x-mordn-draft-follow-ups) were getting
  // stale values on every request. `headers` accepts a resolvable — a function
  // evaluated per request — so route it through a ref instead.
  const headersRef = useRef<Record<string, string>>({});
  useEffect(() => {
    headersRef.current = {
      'X-User-Id': config?.userId || '',
      // Extra headers the host injects (e.g. the dashboard playground sends
      // its unsaved draft model/system-prompt for an owner-authed preview).
      ...(config?.extraHeaders ?? {}),
    };
  }, [config?.userId, config?.extraHeaders]);

  const { messages, sendMessage, status, setMessages, stop, regenerate, error, clearError, addToolApprovalResponse } = useChat({
    id: activeTabId || 'temp-id',
    transport: new DefaultChatTransport({
      api: apiBase || '/',
      // Resolved PER REQUEST (see headersRef above) so host-injected headers
      // are never stale — a static object froze the mount-time values.
      headers: () => headersRef.current,
      // Cookie mode for cross-origin apiBase deployments whose getUserId
      // reads a session cookie (see ChatWidgetConfig.requestCredentials).
      credentials: config?.requestCredentials,
      // Attach first-class per-turn context (#162) to the request body. Read
      // from a ref so the latest context is sent without re-creating the chat.
      // When `context` is undefined it serialises away — zero overhead.
      //
      // CRITICAL: the callback receives `id` and `messages` as SEPARATE fields,
      // NOT inside `body` (which is only the optional custom-body object, usually
      // empty). Whatever we return as `body` IS the entire request payload — so
      // we must explicitly include `id` and `messages`, or the server receives
      // `{}` and rejects with "Missing conversation id". (Default transport adds
      // these for you; once you override prepareSendMessagesRequest you own them.)
      prepareSendMessagesRequest: ({ id, messages, body }) => ({
        body: { ...body, id, messages, context: contextRef.current },
      }),
    }),
    // Human-in-the-loop tool approval: once the user has answered all pending
    // approval requests on the last assistant message, automatically send the
    // responses back so the SDK resumes (runs or skips the tool). Without this
    // the approve/deny clicks wouldn't continue the turn.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // Throttle UI updates while streaming. Default 50ms (~20Hz) for snappy
    // streaming — safe because rendering is targeted (only the active message
    // bubble re-renders per tick; see message-item.tsx). Host-tunable.
    experimental_throttle: config?.streamingThrottleMs ?? 50,
  });

  // Keep the live status mirror in sync (see statusRef above).
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Single activation point for changing the active tab: writes the live ref
  // SYNCHRONOUSLY (before React re-renders) so any in-flight load's staleness
  // check compares against the real active tab, then updates state. Every
  // path that changes the active tab MUST go through this.
  const activateTab = (tabId: string) => {
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
  };

  // Abort an in-flight stream before the active conversation changes. Without
  // this, the previous tab's still-open stream keeps writing into whatever
  // chat instance is current — contaminating the newly-activated conversation
  // on screen AND in what gets persisted on finish. Reads the status mirror so
  // stale-closure callers (memoised callbacks) still see the live value.
  const stopIfStreaming = () => {
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      try {
        stop();
      } catch {
        /* stop() is best-effort — never let an abort failure block a tab switch */
      }
    }
  };

  // Approve / deny a paused tool (human-in-the-loop). Passed down to the tool
  // renderer; the SDK auto-resumes via sendAutomaticallyWhen above.
  const handleToolApproval = useCallback(
    (approvalId: string, approved: boolean) => {
      addToolApprovalResponse({ id: approvalId, approved });
    },
    [addToolApprovalResponse],
  );

  // Synchronous in-flight latch for handleSubmit. `status` only flips to
  // 'submitted' once sendMessage() runs — which, with attachments, is AFTER
  // the entire upload round-trip. For that whole window `status` still reads
  // 'ready', so a second Enter (or a starter-prompt double-click — they all
  // funnel through handleSubmit) would start a parallel upload and a
  // duplicate turn. A ref flips synchronously and closes the window.
  const submittingRef = useRef(false);

  const handleSubmit = async (message: PromptInputMessage) => {
    // Ignore submits while a turn is in flight. The send button already swaps to
    // a Stop button when streaming, but pressing Enter bypasses the button and
    // calls form.requestSubmit() directly — so without this guard a user could
    // queue a second message (or several) mid-response. This is the single choke
    // point both Enter and the button funnel through, so guarding here covers
    // every submission path. To interrupt, the user uses the Stop button.
    if (submittingRef.current || status === 'submitted' || status === 'streaming') {
      return false;
    }

    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return false;
    }

    submittingRef.current = true;
    try {

    // Upload files to Supabase first if there are attachments
    let uploadedFiles: any[] = [];
    if (message.files && message.files.length > 0) {
      try {
        // Upload all files in parallel for better performance
        const uploadPromises = message.files.map(async (file) => {
          try {
            // Convert blob URL back to File object
            const response = await fetch(file.url);
            const blob = await response.blob();
            const fileObj = new File([blob], file.filename || 'unknown', { type: file.mediaType });

            // Upload to our API
            const formData = new FormData();
            formData.append('file', fileObj);
            formData.append('conversationId', activeTabId || 'default');
            // Informational only — the server derives identity from its
            // verified getChatUserId, never from this field. (It used to
            // fall back to a 'demo-user' literal, which read like a trust
            // path that doesn't exist.)
            formData.append('userId', config?.userId ?? '');

            // Same identity/extra headers as the chat transport and feedback
            // POSTs — uploads were the one call site sending none, silently
            // bypassing hosts that read them (e.g. the dashboard playground's
            // draft-preview headers).
            const uploadResponse = await fetch(`${apiBase}/upload`, {
              method: 'POST',
              headers: {
                'X-User-Id': config?.userId || '',
                ...(config?.extraHeaders ?? {}),
              },
              body: formData,
              credentials: config?.requestCredentials
            });

            if (!uploadResponse.ok) {
              const errorText = await uploadResponse.text().catch(() => '<unreadable body>');
              console.error(`Upload failed for ${file.filename}:`, errorText);
              return null; // Return null for failed uploads
            }

            const uploadResult = await uploadResponse.json();
            return {
              id: (file as any).id || 'unknown',
              type: 'file',
              url: uploadResult.url,
              filename: uploadResult.filename,
              mediaType: uploadResult.mediaType,
              size: uploadResult.size
            };
          } catch (error) {
            console.error(`Error uploading ${file.filename}:`, error);
            return null; // Return null for failed uploads
          }
        });

        // Wait for all uploads to complete
        const results = await Promise.all(uploadPromises);

        // Filter out null results (failed uploads)
        uploadedFiles = results.filter(result => result !== null);

        // If no files uploaded successfully, abort the send. Throwing (rather
        // than returning) lets PromptInput keep the attachments mounted so the
        // user can retry instead of having to re-pick every file.
        if (uploadedFiles.length === 0) {
          throw new Error('All file uploads failed. Please try again.');
        }

        // If only some files uploaded, show warning to user
        if (uploadedFiles.length < message.files.length) {
          const warnMsg = `Warning: Only ${uploadedFiles.length} of ${message.files.length} files uploaded successfully.`;
          setUploadError(warnMsg);
          console.warn(warnMsg);
        }

      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : 'Error uploading files. Please try again.';
        setUploadError(errorMsg);
        console.error('Error in file upload process:', error);
        // Re-throw so PromptInput's submit handler preserves the attachments
        // for retry instead of clearing them. (The finally below still clears
        // the in-flight latch on this path.)
        throw error instanceof Error ? error : new Error(errorMsg);
      }
    }

    sendMessage({
      text: message.text || 'Sent with attachments',
      files: uploadedFiles
    });
    // Model and webSearch are sent via transport's prepareSendMessagesRequest using refs

    // Update tab title if this is the first message (title is still "New Chat")
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (activeTab && activeTab.title === 'New Chat' && message.text) {
      const newTitle = message.text.slice(0, 100);
      setTabs(prevTabs =>
        prevTabs.map(tab =>
          tab.id === activeTabId
            ? { ...tab, title: newTitle }
            : tab
        )
      );
    }

    setInput('');
    // The sent message is no longer a draft.
    const sentDraftKey = draftKey(activeTabId);
    if (sentDraftKey) safeSession.remove(sentDraftKey);
    // StickToBottom handles scrolling automatically

    } finally {
      submittingRef.current = false;
    }
  };

  // Centralized function to load a conversation's messages
  const loadConversation = async (conversationId: string) => {
    if (!config?.userId) {
      console.log('Cannot load conversation - no userId');
      return;
    }

    // Staleness guard: this load only gets to write state while it is BOTH the
    // latest load started (gen) and loading the tab that is still active
    // (activeTabIdRef). Otherwise a slow fetch for a previously-viewed tab
    // would overwrite the current tab's messages and corrupt the reverse-
    // pagination cursor. Checked after EVERY await.
    const gen = ++loadGenRef.current;
    const isCurrent = () =>
      mountedRef.current &&
      gen === loadGenRef.current &&
      conversationId === activeTabIdRef.current;

    try {
      // Initial load: only the most-recent page. Older messages stream in as the
      // user scrolls up (loadOlderMessages), so a long conversation opens fast
      // and pinned to the bottom instead of pulling its whole history at once.
      // conversationId/userId are free-form host-supplied strings (emails with
      // '+', ids with '/', '#'…) — encode them or the URL truncates/mis-routes.
      // The userId param is informational only (identity is server-verified);
      // cache:'no-store' keeps one user's history out of any intermediary
      // cache regardless of response-header handling.
      const response = await fetch(
        `${apiBase}/history/${encodeURIComponent(conversationId)}?userId=${encodeURIComponent(config.userId)}&limit=${HISTORY_PAGE_SIZE}`,
        { cache: 'no-store', credentials: config?.requestCredentials },
      );
      if (!isCurrent()) return;
      if (response.ok) {
        const data = await response.json();
        if (!isCurrent()) return;
        const loadedMessages = data.messages || [];

        // Seed the reverse-pagination cursor from the oldest loaded message.
        oldestTsRef.current = loadedMessages.length ? loadedMessages[0].created_at ?? null : null;
        setHasMoreHistory(Boolean(data.hasMore));
        // Safe to apply immediately: by the time the fetch resolved, the
        // render that re-keyed useChat to this conversation has long since
        // committed, and isCurrent() above proves this tab is still active.
        setMessages(loadedMessages);
      } else if (response.status === 404) {
        // Conversation doesn't exist yet - this is normal for new chats.
        // Fresh conversations start from the host's initialMessages seed
        // (usually undefined → empty).
        oldestTsRef.current = null;
        setHasMoreHistory(false);
        setMessages(initialMessagesRef.current ?? []);
      } else {
        console.error('Error loading messages:', response.status, response.statusText);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Error loading conversation:', error);
    }
  };

  // Fetch the previous page of history (older messages) and PREPEND it. Called
  // when the user scrolls near the top. Compensates the scroll position so the
  // viewport stays put as content is inserted above it (no jump). Guarded by a
  // ref so overlapping scroll events don't double-fetch the same page.
  const scrollViewportRef = useRef<HTMLElement | null>(null);
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreHistory || !oldestTsRef.current) return;
    if (!config?.userId || !activeTabId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    // The page we fetch belongs to THIS conversation. If the user switches
    // tabs while the fetch is in flight, dropping the result is the only
    // correct move — prepending it would splice another conversation's
    // messages (and cursor) into the newly-active tab.
    const conversationId = activeTabId;
    const isCurrent = () => mountedRef.current && conversationId === activeTabIdRef.current;

    const viewport = scrollViewportRef.current;
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;

    try {
      const res = await fetch(
        `${apiBase}/history/${encodeURIComponent(activeTabId)}?userId=${encodeURIComponent(config.userId)}` +
          `&limit=${HISTORY_PAGE_SIZE}&before=${encodeURIComponent(oldestTsRef.current)}`,
        { cache: 'no-store', credentials: config?.requestCredentials },
      );
      if (!res.ok || !isCurrent()) return;
      const data = await res.json();
      if (!isCurrent()) return;
      const older = data.messages || [];
      if (older.length === 0) {
        setHasMoreHistory(false);
        return;
      }
      oldestTsRef.current = older[0].created_at ?? oldestTsRef.current;
      setHasMoreHistory(Boolean(data.hasMore));
      // Prepend, de-duping by id (defensive against overlap at the boundary).
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m: { id: string }) => !existing.has(m.id));
        return [...fresh, ...prev];
      });
      // After the prepend renders, restore scroll so the viewport doesn't jump:
      // new scrollTop = old scrollTop + (new height − old height).
      requestAnimationFrame(() => {
        const v = scrollViewportRef.current;
        if (v) v.scrollTop = prevScrollTop + (v.scrollHeight - prevScrollHeight);
      });
    } catch (err) {
      console.error('Error loading older messages:', err);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMoreHistory, config?.userId, config?.apiBase, activeTabId, setMessages]);

  // Tab management functions
  // Generate unique tab ID with better collision avoidance
  const generateUniqueTabId = (): string => {
    let newTabId: string;
    let attempts = 0;
    do {
      newTabId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      attempts++;
    } while (tabs.find(tab => tab.id === newTabId) && attempts < 10);
    
    if (attempts >= 10) {
      throw new Error('Unable to generate unique tab ID');
    }
    
    return newTabId;
  };

  const createNewTab = useCallback(() => {
    // Additional safeguard: prevent creating tabs if we're still loading
    if (!initialTabCreated) {
      console.warn('Cannot create new tab while initializing');
      return;
    }

    // A new tab must never inherit the previous tab's in-flight stream.
    stopIfStreaming();

    // Generate a unique ID for the new tab
    const newTabId = generateUniqueTabId();

    setTabs(prevTabs => {
      // Check if tab with this ID already exists using prevTabs (current state)
      const existingTab = prevTabs.find(tab => tab.id === newTabId);
      if (existingTab) {
        console.warn('Tab with ID already exists:', newTabId);
        return prevTabs; // Return unchanged
      }

      const newTab: ChatTab = {
        id: newTabId,
        title: 'New Chat',
        isActive: true,
      };

      // Save current tab's state before switching
      const updatedTabs = prevTabs.map(tab => ({
        ...tab,
        isActive: false,
      }));

      return [...updatedTabs, newTab];
    });

    activateTab(newTabId);
    // New conversations start from the host's initialMessages seed (usually
    // undefined → empty) — same as the 404 path in loadConversation.
    setMessages(initialMessagesRef.current ?? []);
    setInput('');
  }, [initialTabCreated]);

  const startNewConversation = useCallback(() => {
    createNewTab();
  }, [createNewTab]);

  // Identity-change teardown: when the (agent, user) scope changes WITHOUT a
  // full page reload (e.g. user switches account in-app), clear the previous
  // scope's persisted keys so the new identity never inherits stale tabs.
  const prevPrefixRef = useRef<string | null>(storageKeyPrefix);
  useEffect(() => {
    const prev = prevPrefixRef.current;
    if (prev && prev !== storageKeyPrefix) {
      const stalePrefix = `chat-${prev}-`;
      safeStorage
        .keys()
        .filter((k) => k.startsWith(stalePrefix))
        .forEach((k) => safeStorage.remove(k));
    }
    prevPrefixRef.current = storageKeyPrefix;
  }, [storageKeyPrefix]);

  const switchToTab = async (tabId: string) => {
    const targetTab = tabs.find(tab => tab.id === tabId);
    if (!targetTab) return;

    // Abort any in-flight stream BEFORE re-keying useChat — otherwise the
    // previous tab's open stream keeps appending into the current chat
    // instance, i.e. into the tab we're switching to.
    stopIfStreaming();

    // Update active tab (metadata only)
    setTabs(prevTabs =>
      prevTabs.map(tab => ({
        ...tab,
        isActive: tab.id === tabId,
      }))
    );

    // Change active tab - useChat will reinitialize with new ID. Setting
    // isLoadingMessages immediately gates the starter-prompt empty state
    // so we don't flash it during the API fetch below.
    activateTab(tabId);
    setIsLoadingMessages(true);
    try {
      await loadConversation(tabId);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return; // Don't close the last tab

    // A closed tab's draft goes with it.
    const closedDraftKey = draftKey(tabId);
    if (closedDraftKey) safeSession.remove(closedDraftKey);

    const filteredTabs = tabs.filter(tab => tab.id !== tabId);

    // If we're closing the active tab, switch to another tab
    if (tabId === activeTabId && filteredTabs.length > 0) {
      const newActiveTab = filteredTabs[0];

      // Update tabs first
      setTabs(filteredTabs.map(tab => ({
        ...tab,
        isActive: tab.id === newActiveTab.id
      })));

      // Then switch to the new active tab (this will load messages)
      switchToTab(newActiveTab.id);
    } else {
      // Just remove the tab
      setTabs(filteredTabs);
    }

    // Update localStorage immediately when tab is closed
    const tabsKey = storageKey('tabs');
    if (filteredTabs.length > 0 && tabsKey) {
      safeStorage.set(tabsKey, JSON.stringify(filteredTabs));
      if (tabId === activeTabId) {
        const newActiveTab = filteredTabs[0];
        const activeKey = storageKey('active-tab-id');
        if (activeKey) safeStorage.set(activeKey, newActiveTab.id);
      }
    }
  };

  const fetchConversations = async () => {
    if (historyLoaded) return; // Don't reload if already loaded
    if (!config?.userId) {
      return; // Wait for real userId
    }

    setLoadingHistory(true);
    try {
      const response = await fetch(
        `${apiBase}/history?userId=${encodeURIComponent(config.userId)}`,
        { cache: 'no-store', credentials: config?.requestCredentials },
      );

      if (response.ok) {
        const data = await response.json();
        if (!mountedRef.current) return;
        setConversations(data.conversations || []);
        setHistoryLoaded(true);
      } else {
        console.error('[ChatInterface] Failed to fetch chat history, status:', response.status);
        const errorText = await response.text().catch(() => '<unreadable body>');
        console.error('[ChatInterface] Error response:', errorText);
      }
    } catch (error) {
      console.error('[ChatInterface] Error fetching chat history:', error);
    } finally {
      if (mountedRef.current) setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (showHistory && !historyLoaded && config?.userId) {
      fetchConversations();
    }
  }, [showHistory, historyLoaded, config?.userId]);

  // Load conversations on component mount (only when we have a userId)
  useEffect(() => {
    if (!historyLoaded && config?.userId) {
      fetchConversations();
    }
  }, [historyLoaded, config?.userId]);

  // Note: Message loading is now handled in switchToTab function
  // useChat will automatically manage messages when activeTabId changes

  // Conversation component (StickToBottom) handles auto-scroll automatically during streaming

  // Tab Persistence: Save tabs to localStorage with debouncing
  // Only saves metadata (id, title, model, webSearch) - no messages
  useEffect(() => {
    if (tabs.length > 0) {
      const timeoutId = setTimeout(() => {
        const tabsKey = storageKey('tabs');
        const activeKey = storageKey('active-tab-id');
        if (tabsKey) safeStorage.set(tabsKey, JSON.stringify(tabs));
        if (activeKey) safeStorage.set(activeKey, activeTabId);
      }, 500); // Debounce 500ms

      return () => clearTimeout(timeoutId);
    }
  }, [tabs, activeTabId, storageKeyPrefix]);

  // Draft persistence: a half-typed message survives tab switches AND panel
  // close/reopen (the popup unmounts this whole tree on close — losing the
  // draft was the single most jarring data loss in the widget). Debounced;
  // an empty input removes the key so abandoned tabs don't accrete junk.
  useEffect(() => {
    if (isInitializing) return; // never persist the pre-restore empty state
    const key = draftKey(activeTabId);
    if (!key) return;
    const timeoutId = setTimeout(() => {
      if (input) safeSession.set(key, input);
      else safeSession.remove(key);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [input, activeTabId, storageKeyPrefix, isInitializing]);

  // Tab Persistence: restore tabs from localStorage. Runs once PER REAL SCOPE.
  // If identity (agent, user) isn't known at mount, we provisionally start a
  // clean tab but stay un-initialized, so when the prefix transitions
  // null → real this effect re-runs and restores that scope's saved tabs.
  useEffect(() => {
    if (hasInitialized.current) return;

    // A host-pinned conversation (the public `conversationId` prop — the
    // ChatInterface `id`) wins over restored tabs: the widget opens ON that
    // conversation, whether or not it exists server-side yet (a brand-new id
    // 404s in loadConversation and starts from the initialMessages seed).
    // Restored tabs would silently override the host's explicit navigation
    // intent. Both props were previously accepted-but-ignored.
    if (id) {
      setTabs([{ id, title: 'Chat', isActive: true }]);
      activateTab(id);
      setInitialTabCreated(true);
      hasInitialized.current = true;
      return;
    }

    const startCleanTab = () => {
      const initialTabId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setTabs([{ id: initialTabId, title: 'New Chat', isActive: true }]);
      activateTab(initialTabId);
      setInitialTabCreated(true);
      setIsInitializing(false);
    };

    // No complete identity yet → usable provisional clean tab, but DON'T mark
    // initialized so restore can still happen once the scope is known.
    if (!storageKeyPrefix) {
      if (!initialTabCreated && tabs.length === 0) startCleanTab();
      return;
    }

    const loadInitialTabs = () => {
      const savedTabs = safeStorage.get(`chat-${storageKeyPrefix}-tabs`);
      const savedActiveTabId = safeStorage.get(`chat-${storageKeyPrefix}-active-tab-id`);

      if (savedTabs && savedTabs !== '[]') {
        // Restore saved tabs. Don't flip isInitializing yet — the
        // separate message-load effect below owns that, so the empty
        // state stays gated until we know whether there are messages
        // to render.
        //
        // Trust NOTHING about the stored shape. JSON.parse succeeding does
        // not mean the value is a tab array: a corrupted write, another
        // script sharing the key, or a legacy widget version's schema would
        // all parse fine and then crash tabs.map() at render. Keep only
        // structurally-valid entries, drop unknown fields, and recompute
        // isActive from the restored active id (stored flags can be stale).
        const parsed: unknown = JSON.parse(savedTabs);
        const validTabs = (Array.isArray(parsed) ? parsed : []).filter(
          (t): t is { id: string; title: string } =>
            !!t &&
            typeof (t as { id?: unknown }).id === 'string' &&
            ((t as { id: string }).id.length > 0) &&
            typeof (t as { title?: unknown }).title === 'string'
        );
        if (validTabs.length === 0) {
          startCleanTab();
          return;
        }
        // The stored active id must point at a restored tab — a stale or
        // foreign value would key useChat to a tab that doesn't exist.
        const activeId =
          savedActiveTabId && validTabs.some((t) => t.id === savedActiveTabId)
            ? savedActiveTabId
            : validTabs[0].id;
        setTabs(validTabs.map((t) => ({ id: t.id, title: t.title, isActive: t.id === activeId })));
        activateTab(activeId);
        setInitialTabCreated(true);
      } else if (tabs.length === 0) {
        // Clean start (no saved tabs) — create one empty tab and finish.
        startCleanTab();
      }
    };

    try {
      loadInitialTabs();
    } catch (err) {
      // Corrupted stored JSON or similar — never leave the widget stuck on
      // the loader OR tabless. The previous version of this catch logged
      // "falling back to a clean state" without actually creating one,
      // leaving zero tabs and useChat keyed to nothing.
      console.error('[chat-widget] init failed, falling back to clean start:', err);
      try {
        startCleanTab();
      } catch {
        setIsInitializing(false);
      }
    }
    // Only lock initialization once a REAL scope has been processed.
    hasInitialized.current = true;
    // Re-run when identity arrives (null → real). `id` is captured for lint
    // completeness; the hasInitialized lock makes later changes no-ops (the
    // prop is initial-only by contract).
  }, [storageKeyPrefix, id]);

  // Load messages for active tab when identity is fully resolved.
  const hasLoadedInitialMessages = useRef(false);
  useEffect(() => {
    if (hasLoadedInitialMessages.current) return; // Only run once
    if (!config?.userId) return; // Wait for userId
    // Wait for a complete (agent, user) identity before consuming the one-shot
    // guard. Otherwise, if agentId arrives AFTER userId, the provisional
    // null-phase clean tab would consume this ref and the restored tab (swapped
    // in once the real prefix lands) would render with no messages. A
    // host-pinned conversation is exempt: there is no restore to wait for, and
    // pinned hosts may legitimately run without an agentId (no persistence).
    if (!storageKeyPrefix && !id) return;
    if (!activeTabId) return; // Wait for activeTabId to be set

    // Load the conversation messages, then flip isInitializing false. This
    // keeps the empty-state gate closed until the saved messages render —
    // otherwise the starter prompts flash for the duration of the fetch.
    (async () => {
      try {
        await loadConversation(activeTabId);
      } finally {
        hasLoadedInitialMessages.current = true;
        setIsInitializing(false);
      }
    })();
  }, [config?.userId, activeTabId, storageKeyPrefix, id]);

  // Handle state updates when active tab changes
  // Messages are loaded in switchToTab function, not here
  useEffect(() => {
    if (isInitializing) return; // Don't sync during initialization

    if (activeTabId && tabs.length > 0 && activeTabId !== lastSyncedTabId.current) {
      lastSyncedTabId.current = activeTabId;
      // Restore this tab's saved draft instead of unconditionally wiping the
      // composer — switching tabs used to destroy a half-typed message.
      const key = draftKey(activeTabId);
      setInput((key && safeSession.get(key)) || '');
    }
  }, [activeTabId, isInitializing, tabs.length]); // Only depend on activeTabId

  // Keep tab titles as default for now
  // Tab title updates removed to fix chat flow

  // Group and filter conversations
  const groupedConversations = useMemo(() => {
    const filtered = conversations.filter(conv =>
      searchQuery === '' ||
      conv.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const groups: { [key: string]: Conversation[] } = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    filtered.forEach(conv => {
      const convDate = new Date(conv.updated_at);
      const diffTime = now.getTime() - convDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const diffWeeks = Math.floor(diffDays / 7);
      const diffMonths = Math.floor(diffDays / 30);

      let groupKey: string;

      if (convDate >= today) {
        groupKey = 'Today';
      } else if (convDate >= yesterday) {
        groupKey = 'Yesterday';
      } else if (diffDays <= 7) {
        // Show individual days for the past week
        groupKey = `${diffDays}d ago`;
      } else if (diffWeeks <= 4) {
        // Show weeks for the past month
        groupKey = `${diffWeeks}w ago`;
      } else if (diffMonths <= 12) {
        // Show months for the past year
        groupKey = `${diffMonths}mo ago`;
      } else {
        // Show years for older
        const diffYears = Math.floor(diffMonths / 12);
        groupKey = `${diffYears}y ago`;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(conv);
    });

    // Sort group keys in chronological order
    const sortedGroups = Object.entries(groups).sort((a, b) => {
      const order = ['Today', 'Yesterday'];
      const aIndex = order.indexOf(a[0]);
      const bIndex = order.indexOf(b[0]);

      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      // Extract numbers for comparison
      const aMatch = a[0].match(/(\d+)([dw]|mo|y)/);
      const bMatch = b[0].match(/(\d+)([dw]|mo|y)/);

      if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[1]);
        const bNum = parseInt(bMatch[1]);
        const aUnit = aMatch[2];
        const bUnit = bMatch[2];

        // Convert to days for comparison
        const unitToDays: { [key: string]: number } = { 'd': 1, 'w': 7, 'mo': 30, 'y': 365 };
        const aDays = aNum * unitToDays[aUnit];
        const bDays = bNum * unitToDays[bUnit];

        return aDays - bDays;
      }

      return 0;
    });

    return sortedGroups;
  }, [conversations, searchQuery]);

  // Stable regenerate handler so the memoized list / MessageItem don't see a
  // new function reference each render.
  const handleRegenerate = useCallback(() => {
    // Defense in depth: the regenerate button only renders when the turn is
    // done, but this callback is also handed to renderers that could invoke
    // it at any time. Starting a second turn while one is streaming is the
    // same contamination class as an un-aborted tab switch. (The error
    // banner's retry path is separate and intentionally allows status
    // 'error'.) Reads the live mirror, not the render-time status, because
    // this callback is memoised.
    if (statusRef.current !== 'ready') return;
    regenerate?.();
  }, [regenerate]);

  // Headers for the best-effort feedback POST. Mirror EXACTLY what the chat
  // transport sends (see the useChat DefaultChatTransport above): the end-user
  // id plus any host-injected extra headers. The Next.js handler mounted at
  // apiBase forwards these to the hosted backend with its server-side Bearer
  // token, so the widget reuses one auth mechanism instead of inventing another.
  // Memoized so the memoized MessageItem list doesn't see a new object each render.
  const feedbackHeaders = useMemo(
    () => ({
      'X-User-Id': config?.userId || '',
      ...(config?.extraHeaders ?? {}),
    }),
    [config?.userId, config?.extraHeaders],
  );

  // Follow-up chips (#134): the handler appends a persistent data part after
  // the assistant's text settles. Prefer that one-toggle, server-safe path; keep
  // the original host generator/static list as a backwards-compatible fallback.
  // Chips clear as soon as a new turn starts, so stale suggestions never sit
  // above an in-flight response.
  useEffect(() => {
    const fu = config?.followUps;
    const last = messages[messages.length - 1];
    const settledAssistant = status === 'ready' && !!last && last.role === 'assistant';
    if (!settledAssistant || fu?.enabled === false) {
      if (followUpsForRef.current !== null) {
        followUpsForRef.current = null;
        setFollowUps([]);
      }
      return;
    }

    const dataPart = (last.parts ?? []).find(
      (part) => (part as { type?: string }).type === 'data-follow-ups',
    ) as { data?: { suggestions?: unknown } } | undefined;
    const serverSuggestions = normalizeFollowUpSuggestions(
      dataPart?.data?.suggestions,
      fu?.max ?? 5,
    );
    if (serverSuggestions.length > 0) {
      followUpsForRef.current = last.id;
      setFollowUps(serverSuggestions);
      return;
    }

    // No server data part: use the legacy client-supplied generator/static list.
    if (!fu) {
      if (followUpsForRef.current !== null) setFollowUps([]);
      followUpsForRef.current = null;
      return;
    }
    if (followUpsForRef.current === last.id) return; // already computed this turn
    followUpsForRef.current = last.id;
    const max = resolveFollowUpCount(fu.max);
    if (typeof fu.generate === 'function') {
      const textOf = (m: { role: string; parts?: Array<{ type: string; text?: string }> }): FollowUpMessage => ({
        role: m.role,
        content: (m.parts ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text as string)
          .join('\n\n'),
      });
      const simplified = messages.map(textOf);
      let cancelled = false;
      Promise.resolve()
        .then(() => fu.generate!(simplified))
        .then((suggestions) => {
          if (!cancelled) {
            setFollowUps(normalizeFollowUpSuggestions(suggestions, max));
          }
        })
        .catch(() => {
          if (!cancelled) setFollowUps([]);
        });
      return () => {
        cancelled = true;
      };
    }
    // No server data and no client generator → nothing to show. (Static
    // per-reply suggestion lists were removed: the same chips after every
    // answer are noise — fixed prompts belong in starterPrompts.)
    setFollowUps([]);
  }, [messages, status, config?.followUps]);

  const handleSelectConversation = async (selectedConversationId: string, conversationTitle: string) => {
    if (!config?.userId) return; // Wait for userId

    try {
      // Check if this conversation is already open in a tab
      const existingTab = tabs.find(tab => tab.id === selectedConversationId);

      if (existingTab) {
        // Just switch to the existing tab
        switchToTab(selectedConversationId);
        setShowHistory(false);
        return;
      }

      // Opening a conversation from history is an activation like any other —
      // abort any stream still writing into the current chat instance first.
      stopIfStreaming();

      // Create a new tab with the loaded conversation metadata
      const newTab: ChatTab = {
        id: selectedConversationId,
        title: conversationTitle,
        isActive: true,
      };

      setTabs(prevTabs => {
        // Save current tab's metadata before switching
        const updatedTabs = prevTabs.map(tab => ({
          ...tab,
          isActive: false,
        }));
        return [...updatedTabs, newTab];
      });

      activateTab(selectedConversationId);

      // Load messages using centralized function
      await loadConversation(selectedConversationId);

      // Close the history dropdown
      setShowHistory(false);
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };

    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistory]);

  // Whether to show the "thinking" loader. Naively gating on status==='submitted'
  // leaves a visible gap: the first token flips status to 'streaming' (loader
  // unmounts) but experimental_throttle delays the text paint by up to 200ms, so
  // the user sees an empty bubble for a beat. Keep the loader up through that
  // window — while submitted, OR while streaming but the assistant's last turn
  // has produced nothing renderable yet (no text/tool/source/file parts). Tool
  // calls and text both clear it the instant they render, so a legit tool-using
  // turn doesn't hang the loader.
  const lastMessage = messages.at(-1);
  const lastAssistantHasContent = hasRenderableAssistantContent(lastMessage);
  const showThinking =
    status === 'submitted' || (status === 'streaming' && !lastAssistantHasContent);

  // The AI SDK adds an empty assistant message before its first streamed part.
  // Do not render that zero-height MessageItem while the planning indicator owns
  // the slot: its assistant-after-user mt-4 would push the indicator down for one
  // frame. The real assistant row takes over the same slot once content arrives.
  const transcriptMessages = useMemo(
    () => messagesForTranscript(messages, showThinking),
    [messages, showThinking],
  );

  // Memoized message list. Each message is a memoized <MessageItem>; the SDK
  // reuses old message refs and clones only the streaming (last) one, so only
  // the active bubble re-renders per tick. Assistant turns render through the
  // transcript (in-order text / compact tool rows / thinking) inside MessageItem.
  const renderedMessages = useMemo(
    () =>
      transcriptMessages.map((m, i) => (
        <MessageItem
          key={m.id}
          message={m}
          isFirst={i === 0}
          isLast={i === transcriptMessages.length - 1}
          prevRole={i > 0 ? transcriptMessages[i - 1].role : undefined}
          status={status}
          toolRenderers={config?.toolRenderers}
          actionRenderers={config?.actionRenderers}
          onRegenerate={handleRegenerate}
          onToolApproval={handleToolApproval}
          feedbackEnabled={config?.feedback === true}
          conversationId={activeTabId}
          feedbackApiBase={config?.apiBase}
          feedbackHeaders={feedbackHeaders}
          feedbackCredentials={config?.requestCredentials}
          onFeedback={config?.onFeedback}
        />
      )),
    [transcriptMessages, status, config?.toolRenderers, config?.actionRenderers, handleRegenerate, handleToolApproval, config?.feedback, activeTabId, config?.apiBase, feedbackHeaders, config?.requestCredentials, config?.onFeedback],
  );

  // Seed the planning verb from the last USER message id: it exists from the
  // moment of submit and doesn't change when the assistant message arrives,
  // so the verb never flips mid-gap.
  const lastUserMessageId = messages.findLast((m) => m.role === 'user')?.id ?? 'planning';
  const planningVerb = pickPlanningVerb(lastUserMessageId);

  return (
    <div className="w-full h-full flex flex-col bg-[hsl(var(--chat-background))] overflow-hidden ring-1 ring-[hsl(var(--chat-border))]">
      <div className="flex flex-col h-full w-full overflow-hidden relative chat-widget-container">
        {/* Header Section with Tabs */}
        {/* backdrop-blur removed: the header is a flex sibling of the scroll
            area, nothing ever renders behind it — the blur was dead CSS
            implying a frosted effect that never happened. */}
        <div className="relative z-20 flex min-h-[52px] items-center gap-2 border-b px-3 py-2" style={{
          borderColor: 'hsl(var(--chat-border))',
          backgroundColor: 'hsl(var(--chat-background))'
        }}>
          {/* Tabs Container with Scroll */}
          <div
            className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-hide py-0.5 scroll-smooth"
            role="tablist"
            aria-label="Conversations"
          >
            {/* Apple-style Tab Pills */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'group relative flex min-w-0 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors duration-150',
                  tab.isActive
                    ? 'bg-[hsl(var(--chat-hover-bg))] text-[hsl(var(--chat-text))]'
                    : 'bg-transparent text-[hsl(var(--chat-text-muted))] hover:bg-[hsl(var(--chat-hover-bg))]',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  switchToTab(tab.id);
                }}
                // Keyboard operability: these pills were click-only <div>s —
                // a keyboard user could not switch conversations at all.
                role="tab"
                aria-selected={tab.isActive}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    switchToTab(tab.id);
                  }
                }}
              >
                {/* Tab Title */}
                <span className="truncate max-w-28 text-[13px] font-medium transition-colors">
                  {tab.title}
                </span>

                {/* Close Button. Two rules learned the hard way:
                    (1) while hidden it must be pointer-events-none — an
                    invisible-but-tappable X swallowed touch taps meant to
                    ACTIVATE the tab (touch has no hover to reveal it);
                    (2) keyboard focus isn't blocked by pointer-events, and
                    focus-visible re-reveals + re-enables it, so it stays
                    keyboard-closable. Hover reveal rides the pill's `group`. */}
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={cn(
                      'rounded-lg p-1 transition-all duration-150 flex-shrink-0 -mr-1',
                      'hover:bg-[hsl(var(--chat-hover-bg))]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]',
                      tab.isActive
                        ? 'opacity-60 hover:opacity-100 focus-visible:opacity-100'
                        : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto'
                    )}
                  >
                    <XIcon className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Fixed Action Buttons */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Plus Icon */}
            <button
              type="button"
              onClick={createNewTab}
              aria-label="New chat"
              className="chat-header-icon-button flex size-7 items-center justify-center rounded-[7px] text-[hsl(var(--chat-text-faint))] transition-colors duration-150 hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
              title="New Chat"
            >
              <SquarePenIcon className="size-[15px]" strokeWidth={1.8} />
            </button>

            {/* History Icon */}
            <div ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                aria-label="Chat history"
                aria-expanded={showHistory}
                className={cn(
                  'chat-header-icon-button flex size-7 items-center justify-center rounded-[7px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]',
                  showHistory
                    ? 'bg-[hsl(var(--chat-hover-bg))] text-[hsl(var(--chat-text))]'
                    : 'text-[hsl(var(--chat-text-faint))] hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))]',
                )}
                title="Chat History"
              >
                <HistoryIcon className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            {/* Chat History Dropdown — anchored to the HEADER row, not the
                history button. A right-0 origin on the button wrapper left the
                popover starting from the button and extending past the widget's
                left edge (clipped by the root overflow-hidden) once close /
                header-action buttons sat to its right. Anchoring to the full
                header makes right-0 the widget's right edge, so the popover
                extends leftward only into the header width. */}
            {showHistory && (
              <div className="absolute right-3 top-full z-50 mt-1.5 overflow-hidden rounded-[11px] shadow-[0_6px_20px_rgba(0,0,0,0.07)] animate-in fade-in slide-in-from-top-1 duration-150" style={{
                width: 'min(20rem, calc(100% - 1.5rem))',
                backgroundColor: 'hsl(var(--chat-background))',
                border: '1px solid hsl(var(--chat-border-soft))'
              }}>
                {/* The search field is the only inset surface; the surrounding
                    header and results share the popover background so the panel
                    remains visually continuous. */}
                <div className="p-2.5 pb-2" style={{ backgroundColor: 'hsl(var(--chat-background))' }}>
                  <div className="relative">
                    <SearchIcon
                      className="pointer-events-none absolute left-2.5 top-1/2 size-[13px] -translate-y-1/2 text-[hsl(var(--chat-text-faint))]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      placeholder="Search chats"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search chats"
                      className="h-9 w-full rounded-[9px] bg-[hsl(var(--chat-surface))] pl-8 pr-2.5 text-[13px] text-[hsl(var(--chat-text))] placeholder:text-[hsl(var(--chat-text-subtle))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--chat-primary)/0.18)]"
                    />
                  </div>
                </div>

                {/* Content Area */}
                <div className="max-h-[300px] overflow-y-auto ai-assistant-scrollbar">
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-[13px]" style={{ color: 'hsl(var(--chat-text-muted))' }}>Loading...</div>
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{
                        backgroundColor: 'hsl(var(--chat-surface))'
                      }}>
                        <MessageSquareIcon className="h-5 w-5" style={{ color: 'hsl(var(--chat-text-subtle))' }} strokeWidth={2} />
                      </div>
                      <p className="text-[13px] font-medium mb-0.5" style={{ color: 'hsl(var(--chat-text))' }}>No Conversations</p>
                      <p className="text-[12px]" style={{ color: 'hsl(var(--chat-text-muted))' }}>Start a new chat to begin</p>
                    </div>
                  ) : groupedConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{
                        backgroundColor: 'hsl(var(--chat-surface))'
                      }}>
                        <SearchIcon className="h-5 w-5" style={{ color: 'hsl(var(--chat-text-subtle))' }} strokeWidth={2} />
                      </div>
                      <p className="text-[13px] font-medium mb-0.5" style={{ color: 'hsl(var(--chat-text))' }}>No Results</p>
                      <p className="text-[12px]" style={{ color: 'hsl(var(--chat-text-muted))' }}>Try a different search</p>
                    </div>
                  ) : (
                    <div className="py-0.5">
                      {groupedConversations.map(([groupName, groupConversations]) => (
                        <div key={groupName} className="mb-0.5">
                          {/* Group Header */}
                          {/* Sticky group header DOES overlay the scrolling
                              list — a translucent background makes the
                              backdrop blur real (it was inert behind an
                              opaque fill). */}
                          <div className="px-2.5 py-1 sticky top-0 backdrop-blur-sm z-10" style={{
                            backgroundColor: 'hsl(var(--chat-background) / 0.85)'
                          }}>

                            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--chat-text-subtle))]">{groupName}</h3>
                          </div>

                          {/* Conversation Items */}
                          <div className="px-1 space-y-0.5">
                            {groupConversations.map((conversation) => {
                              const isActiveConversation = activeTabId === conversation.id;
                              return (
                                <button
                                  key={conversation.id}
                                  type="button"
                                  className={cn(
                                    'group relative w-full rounded-[10px] px-2.5 py-2 text-left transition-colors duration-150',
                                    isActiveConversation
                                      ? 'bg-[hsl(var(--chat-hover-bg))]'
                                      : 'hover:bg-[hsl(var(--chat-surface))]',
                                  )}
                                  aria-current={isActiveConversation ? 'page' : undefined}
                                  onClick={() => handleSelectConversation(conversation.id, conversation.title)}
                                >
                                  <div className="flex min-w-0 items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <p
                                          className={cn(
                                            'min-w-0 flex-1 truncate text-[13px] leading-5',
                                            isActiveConversation
                                              ? 'font-semibold text-[hsl(var(--chat-text))]'
                                              : 'font-medium text-[hsl(var(--chat-text-body))]',
                                          )}
                                        >
                                          {conversation.title}
                                        </p>
                                        <time
                                          dateTime={conversation.updated_at}
                                          className="flex-shrink-0 font-mono text-[11px] text-[hsl(var(--chat-text-faint))]"
                                        >
                                          {formatConversationTime(conversation.updated_at)}
                                        </time>
                                      </div>
                                      <p className="truncate text-[12px] leading-4 text-[hsl(var(--chat-text-faint))]">
                                        {conversation.message_count} {conversation.message_count === 1 ? 'message' : 'messages'}
                                      </p>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Consumer-supplied header actions (expand, settings, etc.)
                rendered before the close button so they sit to its left. */}
            {headerActions}

            {/* Close Chat Widget Button */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                className="chat-header-icon-button flex size-7 items-center justify-center rounded-[7px] text-[hsl(var(--chat-text-faint))] transition-colors duration-150 hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
                title="Close Chat"
              >
                <XIcon className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <Conversation
          className="flex-1 max-w-full ai-assistant-scrollbar"
          // Capture the scroll viewport (StickToBottom owns it) so reverse-
          // pagination can read/restore scroll position; trigger loadOlderMessages
          // when scrolled near the top.
          onScrollRef={(el) => {
            scrollViewportRef.current = el;
          }}
          onScroll={(e: React.UIEvent<HTMLElement>) => {
            const el = e.currentTarget;
            if (el.scrollTop < 120 && hasMoreHistory && !loadingOlderRef.current) {
              void loadOlderMessages();
            }
          }}
        >
          <ConversationContent className="max-w-[96%] mx-auto py-6">
            {hasMoreHistory && (
              <div className="flex justify-center py-2" aria-hidden={!loadingOlder}>
                {loadingOlder && <Loader size={14} />}
              </div>
            )}
            {renderedMessages}
            {/* Follow-up suggestions (#134/#220) — a "Related" block attached
                under the completed assistant reply, INSIDE the conversation so
                it reads as part of the answer and scrolls away with it.
                Tapping a row sends it as the next message. */}
            {followUps.length > 0 && (
              <FollowUpSuggestions
                suggestions={followUps}
                onSelect={(text) => {
                  setFollowUps([]);
                  followUpsForRef.current = null;
                  void handleSubmit({ text });
                }}
              />
            )}
            {showThinking && (
              // The ONLY pre-content indicator: a shimmering planning verb
              // ("One moment", "Working on it", …) with no spinner. It uses the
              // same assistant row + mt-4 geometry as the response that replaces
              // it, so the submitted → empty-assistant → first-content transition
              // never changes its vertical or horizontal anchor. The shimmer's
              // transparent text color is protected by its scoped CSS selector.
              <div className="mt-4">
                <Message from="assistant">
                  <MessageContent>
                    <TextShimmer as="span" className="text-[13px] font-medium leading-relaxed">
                      {planningVerb}
                    </TextShimmer>
                  </MessageContent>
                </Message>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="px-5 pb-5">
          {/* Upload Error Display — themed via the semantic danger token
              (raw red-* utilities keyed to the OS dark: variant clashed with
              custom themes and disagreed with ChatErrorBanner below). */}
          {uploadError && (
            <div
              role="alert"
              className="mb-3 px-4 py-3 rounded-2xl text-sm shadow-sm"
              style={{
                backgroundColor: 'hsl(var(--chat-danger) / 0.08)',
                border: '1px solid hsl(var(--chat-danger) / 0.25)',
                color: 'hsl(var(--chat-danger))',
              }}
            >
              {uploadError}
            </div>
          )}

          {/* While we're still hydrating tabs from localStorage and the
              active tab from the API, hold render so we don't briefly flash
              the starter prompts before the previous conversation arrives.
              Once initialised, either show prompts (if truly empty) or the
              messages above this block. */}
          {(isInitializing || isLoadingMessages) ? (
            <div className="flex items-center justify-center py-8" role="status" aria-label="Loading conversation">
              <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: 'hsl(var(--chat-text-muted))' }} />
            </div>
          ) : (
            messages.length === 0 && status !== 'submitted' &&
            ((effectiveStarterPrompts && effectiveStarterPrompts.length > 0) || config?.capabilitiesPrompt || config?.greeting || config?.assistantName) ? (
              <div className="mb-1 flex flex-col gap-4">
                {/* Empty-state greeting — inspired by the shared renderer mockup's
                    front screen. Bottom-anchored feel in the composer zone: a
                    strong greeting line plus the assistant's name as a faint sub
                    line. Both are optional via config (greeting / assistantName);
                    when neither is set the block collapses and only the starter
                    prompts show, so existing embeds are unaffected. */}
                {(config?.greeting || config?.assistantName) && (
                  <div className="px-1">
                    <h2
                      className="text-[17px] font-semibold leading-tight text-[hsl(var(--chat-text))]"
                      style={{ letterSpacing: '-0.01em' }}
                    >
                      {config?.greeting || 'How can I help?'}
                    </h2>
                    {config?.assistantName && (
                      <p className="mt-1 text-[13px] text-[hsl(var(--chat-text-faint))]">
                        {config.assistantName}
                      </p>
                    )}
                  </div>
                )}
                {effectiveStarterPrompts && effectiveStarterPrompts.length > 0 && (
                  <StarterMessages
                    prompts={effectiveStarterPrompts}
                    layout={config?.starterPromptsLayout ?? 'list'}
                    onPromptSelect={(prompt) => {
                      handleSubmit({ text: prompt.title });
                    }}
                  />
                )}
                {/* Always-available "capability discoverability" onramp (#164).
                    Opt-in via config.capabilitiesPrompt; sends that prompt as
                    the user's message so a blank input never strands the user. */}
                {config?.capabilitiesPrompt && (
                  <button
                    type="button"
                    onClick={() => handleSubmit({ text: config.capabilitiesPrompt })}
                    className="mx-3 mb-3 text-[12px] underline underline-offset-2 text-[hsl(var(--chat-text)/0.45)] hover:text-[hsl(var(--chat-text)/0.7)] transition-colors"
                  >
                    Not sure where to start?
                  </button>
                )}
              </div>
            ) : null
          )}

          {/* Inline error banner — appears between the message stream
              and the input when a stream errored / disconnected. */}
          <ChatErrorBanner
            error={error ?? null}
            canRetry={messages.some((m) => m.role === 'user')}
            onRetry={() => {
              clearError?.();
              regenerate?.();
            }}
            onDismiss={clearError}
          />

          {/* Inline mention/command panel — renders above the input
              when an InputPlugin is active. Same layout slot as the
              StarterMessages so the visual language stays consistent. */}
          {inputPlugins.panel}

          <PromptInput
            onSubmit={handleSubmit}
            className="chat-prompt-box"
            globalDrop
            multiple
            accept={config?.features?.fileUploadAccept ?? 'image/*'}
            maxFileSize={config?.features?.fileUploadMaxBytes}
            onError={(err) => {
              if (err.code === 'max_file_size') {
                setUploadError(
                  config?.features?.fileUploadMaxBytes
                    ? `File too large (max ${Math.floor(
                        config.features.fileUploadMaxBytes / 1024 / 1024,
                      )} MB).`
                    : 'File too large.',
                );
              } else if (err.code === 'accept') {
                setUploadError('That file type is not supported.');
              } else if (err.code === 'max_files') {
                setUploadError('Too many files attached.');
              }
            }}
          >
            <PromptInputBody>
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
              {/* Two-zone composer: the editor sits on its own row; a bottom
                  action row carries attach on the left and send on the right.
                  `chat-prompt-box` supplies one quiet bordered surface and a
                  token-derived focus ring in every theme. */}
              <PromptInputTextarea
                ref={inputRef}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={inputPlugins.onKeyDown}
                value={input}
                className="min-h-0 w-full px-3.5 pt-3 pb-1 text-[13.5px] leading-6"
              />
              <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                {config?.features?.fileUpload === true && <AttachButton />}
                <PromptInputSubmit
                  // Filled circular send button, right-aligned in the action row.
                  // Colors come entirely from the Button default variant tokens
                  // (bg-primary / text-primary-foreground / disabled:opacity-50).
                  className="ml-auto size-8 rounded-full p-0 [&_svg]:size-3.5"
                  disabled={status === 'streaming' || status === 'submitted' ? false : !input}
                  status={status}
                  onStop={stop}
                />
              </div>
            </PromptInputBody>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
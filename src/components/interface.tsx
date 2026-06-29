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
import { HistoryIcon, MessageSquareIcon, SearchIcon, ChevronRightIcon, PaperclipIcon, PlusIcon, XIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Fragment } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from './tool';
import {
  Suggestion,
  Suggestions,
} from './suggestion';
import { StarterMessages } from './suggestion2';
import { MessageItem } from './message-item';
import { useChatStorageKey } from '../contexts/chat-storage-context';
import type { StarterPrompt } from '../types';

type Conversation = {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  metadata?: any;
};

type ChatTab = {
  id: string;
  title: string;
  isActive: boolean;
};

export default function ChatInterface({ id, initialMessages, config, onClose, headerActions }: { id?: string; initialMessages?: any[]; config?: any; onClose?: () => void; headerActions?: React.ReactNode } = {}) {
  // Storage key prefix is scoped to (agent, user). It is `null` when identity
  // is incomplete — in that case storageKey() returns null and every caller
  // must skip persistence (no shared/static fallback bucket → no cross-user leak).
  const { storageKeyPrefix } = useChatStorageKey();
  const storageKey = (key: string): string | null =>
    storageKeyPrefix ? `chat-${storageKeyPrefix}-${key}` : null;

  // Get theme mode from config (defaults to 'light')
  const themeMode = config?.theme?.mode || 'light';

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

  // Track last synced tab to prevent infinite loops
  const lastSyncedTabId = useRef<string>('');

  // Ref-based initialization guard to ensure initialization runs only once
  const hasInitialized = useRef(false);

  const { messages, sendMessage, status, setMessages, stop, regenerate, error, clearError } = useChat({
    id: activeTabId || 'temp-id',
    transport: new DefaultChatTransport({
      api: `${config?.apiBase ?? '/api/chat'}`,
      headers: {
        'X-User-Id': config?.userId || '',
        // Extra headers the host injects (e.g. the dashboard playground sends
        // its unsaved draft model/system-prompt for an owner-authed preview).
        ...(config?.extraHeaders ?? {}),
      },
    }),
    // Throttle UI updates while streaming. Default 50ms (~20Hz) for snappy
    // streaming — safe because rendering is targeted (only the active message
    // bubble re-renders per tick; see message-item.tsx). Host-tunable.
    experimental_throttle: config?.streamingThrottleMs ?? 50,
  });

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

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
            formData.append('userId', config?.userId || 'demo-user');

            const uploadResponse = await fetch(`${config?.apiBase ?? '/api/chat'}/upload`, {
              method: 'POST',
              body: formData
            });
            
            if (!uploadResponse.ok) {
              const errorText = await uploadResponse.text();
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

        // If no files uploaded successfully, show error to user
        if (uploadedFiles.length === 0) {
          const errorMsg = 'All file uploads failed. Please try again.';
          setUploadError(errorMsg);
          console.error(errorMsg);
          return;
        }

        // If only some files uploaded, show warning to user
        if (uploadedFiles.length < message.files.length) {
          const warnMsg = `Warning: Only ${uploadedFiles.length} of ${message.files.length} files uploaded successfully.`;
          setUploadError(warnMsg);
          console.warn(warnMsg);
        }

      } catch (error) {
        const errorMsg = 'Error uploading files. Please try again.';
        setUploadError(errorMsg);
        console.error('Error in file upload process:', error);
        return;
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
    // StickToBottom handles scrolling automatically
  };

  // Attachment button component that uses the attachments context.
  // Compact ghost icon button on the left of the prompt row — sized to match
  // the send button (size-9) so the row reads as balanced, with a muted
  // paperclip that doesn't compete with the text or the send action.
  const AttachButton = () => {
    const attachments = usePromptInputAttachments();
    return (
      <PromptInputButton
        variant="ghost"
        size="icon"
        className="size-9 rounded-full text-muted-foreground"
        aria-label="Attach files"
        onClick={() => attachments.openFileDialog()}
      >
        {/* lucide's Paperclip runs bottom-left→top-right; rotate -45° to
            stand it upright (vertical). */}
        <PaperclipIcon className="size-4 -rotate-45" />
      </PromptInputButton>
    );
  };

  // Centralized function to load a conversation's messages
  const loadConversation = async (conversationId: string) => {
    if (!config?.userId) {
      console.log('Cannot load conversation - no userId');
      return;
    }

    try {
      const response = await fetch(`${config?.apiBase ?? '/api/chat'}/history/${conversationId}?userId=${config.userId}`);
      if (response.ok) {
        const data = await response.json();
        const loadedMessages = data.messages || [];

        // Set messages after ensuring activeTabId state has updated
        setTimeout(() => {
          setMessages(loadedMessages);
        }, 0);
      } else if (response.status === 404) {
        // Conversation doesn't exist yet - this is normal for new chats
        console.log('Conversation not found in database yet (new chat)');
        // Clear messages for new chat
        setMessages([]);
      } else {
        console.error('Error loading messages:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

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

    setActiveTabId(newTabId);
    setMessages([]);
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
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(stalePrefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
    prevPrefixRef.current = storageKeyPrefix;
  }, [storageKeyPrefix]);

  const switchToTab = async (tabId: string) => {
    const targetTab = tabs.find(tab => tab.id === tabId);
    if (!targetTab) return;

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
    setActiveTabId(tabId);
    setIsLoadingMessages(true);
    try {
      await loadConversation(tabId);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return; // Don't close the last tab

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
      localStorage.setItem(tabsKey, JSON.stringify(filteredTabs));
      if (tabId === activeTabId) {
        const newActiveTab = filteredTabs[0];
        const activeKey = storageKey('active-tab-id');
        if (activeKey) localStorage.setItem(activeKey, newActiveTab.id);
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
      const response = await fetch(`${config?.apiBase ?? '/api/chat'}/history?userId=${config.userId}`);

      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations || []);
        setHistoryLoaded(true);
      } else {
        console.error('[ChatInterface] Failed to fetch chat history, status:', response.status);
        const errorText = await response.text();
        console.error('[ChatInterface] Error response:', errorText);
      }
    } catch (error) {
      console.error('[ChatInterface] Error fetching chat history:', error);
    } finally {
      setLoadingHistory(false);
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
        if (tabsKey) localStorage.setItem(tabsKey, JSON.stringify(tabs));
        if (activeKey) localStorage.setItem(activeKey, activeTabId);
      }, 500); // Debounce 500ms

      return () => clearTimeout(timeoutId);
    }
  }, [tabs, activeTabId, storageKeyPrefix]);

  // Tab Persistence: restore tabs from localStorage. Runs once PER REAL SCOPE.
  // If identity (agent, user) isn't known at mount, we provisionally start a
  // clean tab but stay un-initialized, so when the prefix transitions
  // null → real this effect re-runs and restores that scope's saved tabs.
  useEffect(() => {
    if (hasInitialized.current) return;

    const startCleanTab = () => {
      const initialTabId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setTabs([{ id: initialTabId, title: 'New Chat', isActive: true }]);
      setActiveTabId(initialTabId);
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
      const savedTabs = localStorage.getItem(`chat-${storageKeyPrefix}-tabs`);
      const savedActiveTabId = localStorage.getItem(`chat-${storageKeyPrefix}-active-tab-id`);

      if (savedTabs && savedTabs !== '[]') {
        // Restore saved tabs. Don't flip isInitializing yet — the
        // separate message-load effect below owns that, so the empty
        // state stays gated until we know whether there are messages
        // to render.
        const parsedTabs = JSON.parse(savedTabs);
        setTabs(parsedTabs);
        const activeId = savedActiveTabId || parsedTabs[0]?.id;
        setActiveTabId(activeId);
        setInitialTabCreated(true);
      } else if (tabs.length === 0) {
        // Clean start (no saved tabs) — create one empty tab and finish.
        startCleanTab();
      }
    };

    try {
      loadInitialTabs();
    } catch (err) {
      // localStorage parse failure or similar — never leave the widget
      // stuck on the loader; fall back to a clean state.
      console.error('[chat-widget] init failed, falling back to clean start:', err);
      setIsInitializing(false);
    }
    // Only lock initialization once a REAL scope has been processed.
    hasInitialized.current = true;
  }, [storageKeyPrefix]); // Re-run when identity arrives (null → real)

  // Load messages for active tab when identity is fully resolved.
  const hasLoadedInitialMessages = useRef(false);
  useEffect(() => {
    if (hasLoadedInitialMessages.current) return; // Only run once
    if (!config?.userId) return; // Wait for userId
    // Wait for a complete (agent, user) identity before consuming the one-shot
    // guard. Otherwise, if agentId arrives AFTER userId, the provisional
    // null-phase clean tab would consume this ref and the restored tab (swapped
    // in once the real prefix lands) would render with no messages.
    if (!storageKeyPrefix) return;
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
  }, [config?.userId, activeTabId, storageKeyPrefix]);

  // Handle state updates when active tab changes
  // Messages are loaded in switchToTab function, not here
  useEffect(() => {
    if (isInitializing) return; // Don't sync during initialization

    if (activeTabId && tabs.length > 0 && activeTabId !== lastSyncedTabId.current) {
      lastSyncedTabId.current = activeTabId;
      setInput('');
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
    regenerate?.();
  }, [regenerate]);

  // Memoized message list. Each message is a memoized <MessageItem>; the SDK
  // reuses old message refs and clones only the streaming (last) one, so only
  // the active bubble re-renders per tick. Assistant turns render through the
  // transcript (in-order text / compact tool rows / thinking) inside MessageItem.
  const renderedMessages = useMemo(
    () =>
      messages.map((m, i) => (
        <MessageItem
          key={m.id}
          message={m}
          isFirst={i === 0}
          isLast={i === messages.length - 1}
          status={status}
          toolRenderers={config?.toolRenderers}
          onRegenerate={handleRegenerate}
        />
      )),
    [messages, status, config?.toolRenderers, handleRegenerate],
  );

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

      setActiveTabId(selectedConversationId);

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
  const lastAssistantHasContent =
    lastMessage?.role === 'assistant' &&
    (lastMessage.parts ?? []).some(
      (p) =>
        (p.type === 'text' && p.text.length > 0) ||
        (p.type === 'reasoning' && p.text.length > 0) ||
        p.type === 'source-url' ||
        p.type === 'file' ||
        p.type === 'dynamic-tool' ||
        p.type.startsWith('tool-'),
    );
  const showThinking =
    status === 'submitted' || (status === 'streaming' && !lastAssistantHasContent);

  return (
    <div className={cn("w-full h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden ring-1 ring-black/[0.02] dark:ring-white/[0.03]", themeMode === 'dark' && 'dark')}>
      <div
        className={cn(
          "flex flex-col h-full w-full overflow-hidden relative chat-widget-container",
          themeMode === 'dark' && 'dark'
        )}
      >
        {/* Header Section with Tabs */}
        <div className="flex items-center gap-2 px-3 py-2 border-b backdrop-blur-sm relative z-20" style={{
          borderColor: 'var(--chat-divider)',
          backgroundColor: 'var(--chat-header-bg)'
        }}>
          {/* Tabs Container with Scroll */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-hide py-0.5 scroll-smooth">
            {/* Apple-style Tab Pills */}
            {tabs.map((tab, index) => (
              <div
                key={tab.id}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150 group flex-shrink-0 min-w-0"
                style={{
                  backgroundColor: tab.isActive
                    ? ('hsl(var(--chat-surface))')
                    : 'transparent',
                  color: tab.isActive
                    ? ('hsl(var(--chat-text))')
                    : ('hsl(var(--chat-text-muted))')
                }}
                onMouseEnter={(e) => {
                  if (!tab.isActive) {
                    e.currentTarget.style.backgroundColor = 'var(--chat-hover-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!tab.isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  switchToTab(tab.id);
                }}
              >
                {/* Tab Title */}
                <span className="truncate max-w-28 text-[13px] font-medium transition-colors">
                  {tab.title}
                </span>

                {/* Close Button */}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="rounded-lg p-1 transition-all duration-150 flex-shrink-0 -mr-1"
                    style={{
                      opacity: tab.isActive ? 0.6 : 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.backgroundColor = 'hsl(var(--chat-surface-hover))';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = tab.isActive ? '0.6' : '0';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
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
              onClick={createNewTab}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150"
              style={{
                color: 'hsl(var(--chat-text-muted))'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'hsl(var(--chat-text))';
                e.currentTarget.style.backgroundColor = 'hsl(var(--chat-surface))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'hsl(var(--chat-text-muted))';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="New Chat"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2} />
            </button>

            {/* History Icon */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150"
                style={{
                  color: showHistory
                    ? ('hsl(var(--chat-text))')
                    : ('hsl(var(--chat-text-muted))'),
                  backgroundColor: showHistory
                    ? ('hsl(var(--chat-surface))')
                    : 'transparent'
                }}
                onMouseEnter={(e) => {
                  if (!showHistory) {
                    e.currentTarget.style.color = 'hsl(var(--chat-text))';
                    e.currentTarget.style.backgroundColor = 'hsl(var(--chat-surface))';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showHistory) {
                    e.currentTarget.style.color = 'hsl(var(--chat-text-muted))';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
                title="Chat History"
              >
                <HistoryIcon className="h-4 w-4" strokeWidth={2} />
              </button>

            {/* Chat History Dropdown */}
            {showHistory && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.3)] z-50 animate-in fade-in slide-in-from-top-1 duration-150 overflow-hidden" style={{
                backgroundColor: 'hsl(var(--chat-background))',
                border: `1px solid ${'var(--chat-divider)'}`
              }}>
                {/* Search Header */}
                <div className="p-2.5 border-b" style={{
                  borderColor: 'var(--chat-divider)',
                  backgroundColor: 'var(--chat-overlay)'
                }}>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-7 px-2.5 text-[13px] rounded-lg focus:outline-none transition-all"
                      style={{
                        backgroundColor: 'hsl(var(--chat-surface-deep))',
                        border: `1px solid ${'var(--chat-divider)'}`,
                        color: 'hsl(var(--chat-text))'
                      }}
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
                          <div className="px-2.5 py-1 sticky top-0 backdrop-blur-sm z-10" style={{
                            backgroundColor: 'var(--chat-header-bg-strong)'
                          }}>
                            <h3 className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--chat-text-muted))' }}>{groupName}</h3>
                          </div>

                          {/* Conversation Items */}
                          <div className="px-1 space-y-0.5">
                            {groupConversations.map((conversation) => {
                              const isActiveConversation = activeTabId === conversation.id;
                              return (
                                <button
                                  key={conversation.id}
                                  className="w-full px-2 py-1 rounded-md transition-all duration-150 text-left group relative"
                                  style={{
                                    backgroundColor: isActiveConversation
                                      ? ('hsl(var(--chat-surface))')
                                      : 'transparent'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isActiveConversation) {
                                      e.currentTarget.style.backgroundColor = 'var(--chat-hover-bg)';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isActiveConversation) {
                                      e.currentTarget.style.backgroundColor = 'transparent';
                                    }
                                  }}
                                  onClick={() => handleSelectConversation(conversation.id, conversation.title)}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] line-clamp-1 transition-colors leading-tight" style={{
                                        fontWeight: isActiveConversation ? 500 : 400,
                                        color: isActiveConversation
                                          ? ('hsl(var(--chat-text))')
                                          : ('hsl(var(--chat-text-strong))')
                                      }}>
                                        {conversation.title}
                                      </p>
                                    </div>
                                    <ChevronRightIcon
                                      className="h-3 w-3 transition-all duration-150 flex-shrink-0"
                                      style={{
                                        color: 'hsl(var(--chat-text-subtle))',
                                        opacity: isActiveConversation ? 1 : 0
                                      }}
                                      strokeWidth={2}
                                    />
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
            </div>

            {/* Consumer-supplied header actions (expand, settings, etc.)
                rendered before the close button so they sit to its left. */}
            {headerActions}

            {/* Close Chat Widget Button */}
            {onClose && (
              <button
                onClick={onClose}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150"
                style={{
                  color: 'hsl(var(--chat-text-muted))'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'hsl(var(--chat-text))';
                  e.currentTarget.style.backgroundColor = 'hsl(var(--chat-surface))';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'hsl(var(--chat-text-muted))';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="Close Chat"
              >
                <XIcon className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <Conversation className="flex-1 max-w-full ai-assistant-scrollbar">
          <ConversationContent className="max-w-[96%] mx-auto py-6">
            {renderedMessages}
            {showThinking && (
              <div className="mt-6">
                <Message from="assistant">
                  <MessageContent>
                    <Loader size={16} />
                  </MessageContent>
                </Message>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="px-5 pb-5">
          {/* Upload Error Display */}
          {uploadError && (
            <div className="mb-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200/60 dark:border-red-800/60 rounded-2xl text-sm text-red-700 dark:text-red-400 shadow-sm">
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
            ((effectiveStarterPrompts && effectiveStarterPrompts.length > 0) || config?.capabilitiesPrompt) ? (
              <div className="mb-1">
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
              {/* One row (matches the build-page PromptBar): editor grows on the
                  left, actions inline on the right. `items-end` keeps the send
                  button anchored to the bottom as the editor grows multi-line. */}
              <div className="flex items-end gap-1.5 px-2 py-2">
                {config?.features?.fileUpload === true && <AttachButton />}
                <PromptInputTextarea
                  ref={inputRef}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={inputPlugins.onKeyDown}
                  value={input}
                  className="min-h-0 flex-1 px-1 py-1.5 leading-7"
                />
                <PromptInputSubmit
                  // Circular send button, sized to match the attach button
                  // (size-9) so the row reads as balanced. Always visible; the
                  // Button's disabled:opacity-50 mutes it when empty, full-strength
                  // primary when there's input. Stays enabled mid-stream so the
                  // stop click is reachable.
                  className="size-9 rounded-full p-0 [&_svg]:size-4"
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
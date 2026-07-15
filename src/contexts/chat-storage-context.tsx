'use client';

import { createContext, useContext, ReactNode } from 'react';

interface ChatStorageContextValue {
  /**
   * Prefix for browser-stored chat keys, derived only from the opaque scope in
   * the authenticated bootstrap response. `null` disables persistence.
   */
  storageKeyPrefix: string | null;
}

const ChatStorageContext = createContext<ChatStorageContextValue>({
  storageKeyPrefix: null,
});

export function ChatStorageProvider({
  children,
  storageScope,
}: {
  children: ReactNode;
  /** Opaque, server-issued scope from the authenticated bootstrap response. */
  storageScope?: string | null;
}) {
  // Identity never crosses the public client API. The server derives this
  // opaque value from authenticated identity + the resolved agent.
  const storageKeyPrefix = storageScope ? encodeURIComponent(storageScope) : null;

  return (
    <ChatStorageContext.Provider value={{ storageKeyPrefix }}>
      {children}
    </ChatStorageContext.Provider>
  );
}

export function useChatStorageKey() {
  return useContext(ChatStorageContext);
}

/**
 * Remove chat data this widget persisted in the browser. Call this on sign-out
 * / user switch so a subsequent user on the same browser can never see the
 * previous user's conversation tabs, titles, prompts, or model.
 *
 * - No args → clears every `chat-*` key (safe blanket sign-out clear).
 * - `{ storageScope }` → clears only keys for that server-issued opaque scope.
 *
 * Sweeps BOTH localStorage (tabs, panel state) and sessionStorage (per-tab
 * composer drafts) — the same key scheme is used in both.
 */
export function clearChatStorage(opts?: { storageScope?: string }): void {
  if (typeof window === 'undefined') return;

  const scopedPrefix = opts?.storageScope
    ? `chat-${encodeURIComponent(opts.storageScope)}-`
    : null;

  const sweep = (storage: Storage) => {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (scopedPrefix ? key.startsWith(scopedPrefix) : key.startsWith('chat-')) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => storage.removeItem(key));
  };

  try {
    sweep(window.localStorage);
  } catch {
    /* storage unavailable — nothing to clear */
  }
  try {
    sweep(window.sessionStorage);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

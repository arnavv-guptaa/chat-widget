'use client';

import { createContext, useContext, ReactNode } from 'react';

interface ChatStorageContextValue {
  /**
   * Prefix for all browser-stored chat keys, scoped to (agent, user):
   * `${agentId}-${userId}`. `null` means we do NOT have a complete identity
   * (missing agentId or userId) and callers MUST NOT persist anything — there
   * is deliberately no shared/static fallback bucket, which previously let one
   * user's cached chats leak to another on the same browser.
   */
  storageKeyPrefix: string | null;
}

const ChatStorageContext = createContext<ChatStorageContextValue>({
  storageKeyPrefix: null,
});

export function ChatStorageProvider({
  children,
  userId,
  agentId,
}: {
  children: ReactNode;
  userId?: string;
  agentId?: string;
}) {
  // Both axes are required. Browser cache is scoped to (agent, user) so the
  // same browser never surfaces another user's — or another agent's — data.
  // Encode each segment + use a separator that can't appear in an encoded id,
  // so distinct (agent, user) pairs can never collide into the same prefix
  // (e.g. ('a','b-c') vs ('a-b','c') must NOT both become 'a-b-c').
  const storageKeyPrefix =
    userId && agentId ? `${encodeURIComponent(agentId)}|${encodeURIComponent(userId)}` : null;

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
 * - No args → clears EVERY `chat-*` key (safe blanket sign-out clear), PLUS
 *   the script-tag embed's anonymous visitor id — that id IS chat identity
 *   (it scopes server-side conversations/memory), and leaving it behind would
 *   hand the next visitor on this browser the previous visitor's anonymous
 *   scope.
 * - `{ agentId, userId }` → clears only that scope's keys
 *   (`chat-${agentId}|${userId}-*`). The anon id is untouched here: a scoped
 *   clear targets a signed-in identity, which is never the anon id.
 *
 * Sweeps BOTH localStorage (tabs, panel state) and sessionStorage (per-tab
 * composer drafts) — the same key scheme is used in both.
 */
export function clearChatStorage(opts?: { agentId?: string; userId?: string }): void {
  if (typeof window === 'undefined') return;

  const scopedPrefix =
    opts?.agentId && opts?.userId
      ? `chat-${encodeURIComponent(opts.agentId)}|${encodeURIComponent(opts.userId)}-`
      : null;

  const sweep = (storage: Storage) => {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (scopedPrefix ? key.startsWith(scopedPrefix) : key.startsWith('chat-')) {
        toRemove.push(key);
      } else if (!scopedPrefix && key.startsWith('mordn-chat-anon-id')) {
        // Legacy global + per-agent scoped variants. Keep this literal in
        // sync with ANON_ID_KEY in src/embed/index.tsx (importing it here
        // would pull the embed's react-dom/client into the library graph).
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

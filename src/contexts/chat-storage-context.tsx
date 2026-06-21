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
 * Remove chat data this widget persisted in localStorage. Call this on sign-out
 * / user switch so a subsequent user on the same browser can never see the
 * previous user's conversation tabs, titles, prompts, or model.
 *
 * - No args → clears EVERY `chat-*` key (safe blanket sign-out clear).
 * - `{ agentId, userId }` → clears only that scope's keys (`chat-${agentId}-${userId}-*`).
 */
export function clearChatStorage(opts?: { agentId?: string; userId?: string }): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const scopedPrefix =
    opts?.agentId && opts?.userId
      ? `chat-${encodeURIComponent(opts.agentId)}|${encodeURIComponent(opts.userId)}-`
      : null;

  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (scopedPrefix ? key.startsWith(scopedPrefix) : key.startsWith('chat-')) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}

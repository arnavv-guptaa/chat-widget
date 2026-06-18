'use client';

import { createContext, useContext, ReactNode } from 'react';

interface ChatStorageContextValue {
  storageKeyPrefix: string;
}

const ChatStorageContext = createContext<ChatStorageContextValue>({
  storageKeyPrefix: '',
});

export function ChatStorageProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId?: string;
}) {
  // Use userId as the storage key prefix to isolate data between users/deployments
  const storageKeyPrefix = userId || '';

  return (
    <ChatStorageContext.Provider value={{ storageKeyPrefix }}>
      {children}
    </ChatStorageContext.Provider>
  );
}

export function useChatStorageKey() {
  return useContext(ChatStorageContext);
}

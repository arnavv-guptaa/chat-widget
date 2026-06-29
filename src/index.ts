'use client';

/**
 * @mordn/chat-widget
 *
 * A customizable AI chat widget for React applications.
 *
 * @example
 * ```tsx
 * import { ChatWidget } from '@mordn/chat-widget';
 * import '@mordn/chat-widget/styles.css';
 *
 * export default function App() {
 *   return (
 *     <ChatWidget
 *       userId="user-123"
 *       theme={{ mode: 'dark' }}
 *       display={{ width: '400px' }}
 *     />
 *   );
 * }
 * ```
 */

// Main component
export { ChatWidget, default } from './ChatWidget';

// Types
export type {
  ChatWidgetConfig,
  ThemeConfig,
  FeatureConfig,
  DisplayConfig,
  ChatWidgetSize,
  StarterPrompt,
  InputPlugin,
  InputPluginItem,
  ToolRenderer,
  ToolPartLike,
  FollowUpConfig,
  FollowUpMessage,
} from './types';

export type { ChatWidgetProps } from './ChatWidget';

// Hooks
export * from './hooks/use-chat-theme';

// Supported gateway models are exposed via the dedicated, server-safe subpath
// '@mordn/chat-widget/models' (no "use client"), so server actions can import
// the list too. There is intentionally NO default-model export: an agent's
// model is an explicit, required developer choice (one model per agent).

// Contexts
export { ChatStorageProvider, useChatStorageKey, clearChatStorage } from './contexts/chat-storage-context';

// UI Components (for advanced customization)
export { Button } from './ui/button';
export { Input } from './ui/input';
export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

// Starter Messages Component
export { StarterMessages, StarterMessageItem } from './components/suggestion2';

// Tool render building blocks — exposed so host apps can compose
// custom toolRenderers using the same chrome the default rendering
// uses.
export {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from './components/tool';

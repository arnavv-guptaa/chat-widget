'use client';

/**
 * @mordn/chat-widget
 *
 * A customizable AI chat widget for React applications.
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
  ChatContext,
  InputPlugin,
  InputPluginItem,
  ToolRenderer,
  ToolPartLike,
  ActionRenderer,
  ActionResult,
  ActionResultStatus,
  ActionResultField,
  FollowUpConfig,
  FollowUpMessage,
  FeedbackEvent,
} from './types';

export type { ChatWidgetProps, ChatWidgetHandle } from './ChatWidget';

// Hooks
export * from './hooks/use-chat-theme';

// Contexts
export { ChatStorageProvider, useChatStorageKey, clearChatStorage } from './contexts/chat-storage-context';

// UI Components (for advanced customization)
export { Button } from './ui/button';
export { Input } from './ui/input';
export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

// Starter Messages Component
export { StarterMessages, StarterMessageItem } from './components/suggestion2';

// Message/citation building blocks for high-quality custom renderers.
export { Message, MessageContent, MessageMetadata, MessageAvatar } from './components/message';
export type { MessageProps, MessageContentProps, MessageMetadataProps, MessageAvatarProps } from './components/message';
export { Sources, SourcesTrigger, SourcesContent, Source } from './components/sources';
export type { SourcesProps, SourcesTriggerProps, SourcesContentProps, SourceProps } from './components/sources';

// Action result card (#166) — structured, false-completion-proof tool results
export { ActionResultCard } from './components/action-result-card';
export type { ActionResultCardProps } from './components/action-result-card';

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

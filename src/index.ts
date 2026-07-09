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
  UiRenderer,
  ActionResult,
  ActionResultStatus,
  ActionResultField,
  FollowUpConfig,
  FollowUpMessage,
  FeedbackEvent,
} from './types';

export type { ChatWidgetProps, ChatWidgetHandle } from './ChatWidget';

// Hooks

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

// Action/template primitives — foundation for vertical assistants and generative UI.
export {
  ActionButton,
  ActionChips,
  ActionForm,
  ConfirmationCard,
  EntityCard,
  EntityCarousel,
  SelectionGroup,
  StatusTracker,
  SummaryCard,
} from './components/action-primitives';
export type {
  ActionButtonProps,
  ActionChipsProps,
  ActionFormField,
  ActionFormProps,
  ConfirmationCardProps,
  EntityCardProps,
  EntityCarouselProps,
  SelectionGroupProps,
  StatusTrackerProps,
  SummaryCardProps,
} from './components/action-primitives';

// Generative-GUI runtime — turns a serialised GUI spec into an interactive
// primitive inside the transcript, and dispatches the actions it emits.
export { MordnGuiPart } from './components/gui-part';
export type { MordnGuiPartProps } from './components/gui-part';
export { useActionDispatcher, MORDN_CLIENT_ACTIONS } from './hooks/use-action-dispatcher';
export type { UseActionDispatcherOptions } from './hooks/use-action-dispatcher';
export { submitAction } from './utils/action-transport';
export {
  defaultMordnTemplates,
  docsAssistantTemplate,
  ecommerceConciergeTemplate,
  getMordnTemplate,
  leadCaptureTemplate,
  restaurantAssistantTemplate,
  servicesBookingTemplate,
  travelPlannerTemplate,
} from './actions';
export type {
  MordnActionConfig,
  MordnActionConfirmationPolicy,
  MordnActionDispatcher,
  MordnActionEvent,
  MordnActionHandler,
  MordnActionLoadingBehavior,
  MordnActionPrimitiveProps,
  MordnActionResult,
  MordnActionRiskLevel,
  MordnActionSchema,
  MordnActionSchemaProperty,
  MordnActionStatus,
  MordnEntityAction,
  MordnEntityAttribute,
  MordnEntityItem,
  MordnGuiEntityItem,
  MordnGuiFormField,
  MordnGuiKind,
  MordnGuiRow,
  MordnGuiSpec,
  MordnSelectionOption,
  MordnStatusStep,
  MordnTemplateActionDefinition,
  MordnTemplateCardDefinition,
  MordnTemplateManifest,
  MordnTemplateStarterPrompt,
  MordnTemplateVertical,
} from './actions';

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

export * from './theme-presets';

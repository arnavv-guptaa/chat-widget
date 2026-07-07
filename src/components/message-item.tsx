import { Fragment, memo, useMemo } from 'react';
import type { UIMessage, ChatStatus } from 'ai';
import { cn } from '../utils/cn';
import { Message, MessageContent, MessageMetadata } from './message';
import { Response } from './response';
import { Source, Sources, SourcesContent, SourcesTrigger } from './sources';
import { MessageAttachments } from './message-attachments';
import { MessageActions } from './message-actions';
import { AgentTurnTranscript } from './transcript/AgentTurnTranscript';
import type { TurnState } from './transcript/types';
import type { ActionRenderer, ToolRenderer, FeedbackEvent } from '../types';

/**
 * One message in the conversation, as its own memoized component.
 *
 * WHY THIS EXISTS — targeted streaming re-renders:
 * The parent re-renders on every throttled streaming tick (the AI SDK swaps the
 * `messages` array reference each tick). Without a per-message boundary, that
 * re-maps and re-renders EVERY message (re-parsing markdown, re-stringifying
 * tool JSON, re-diffing data: image attachments) on each tick — cost scales with
 * conversation length + attachments.
 *
 * The AI SDK reuses old message object references across ticks and replaces ONLY
 * the streaming (last) message with a fresh clone. So a DEFAULT `React.memo`
 * shallow-compare is exactly right: static messages keep their reference and bail
 * out; the streaming message gets a new reference and re-renders every tick.
 *
 * ⚠️ DO NOT add a custom comparator or a content signature (e.g. parts.length /
 * text length). A signature would NOT change while the last text part grows
 * character-by-character, so it would BAIL on the streaming message and FREEZE
 * the bubble mid-token. Default shallow compare on the message object is both
 * simpler and the only safe choice here.
 */
interface MessageItemProps {
  message: UIMessage;
  isFirst: boolean;
  isLast: boolean;
  prevRole?: UIMessage['role'];
  status: ChatStatus;
  toolRenderers?: Record<string, ToolRenderer>;
  actionRenderers?: Record<string, ActionRenderer>;
  onRegenerate?: () => void;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
  feedbackEnabled?: boolean;
  conversationId?: string;
  feedbackApiBase?: string;
  feedbackHeaders?: Record<string, string>;
  onFeedback?: (feedback: FeedbackEvent) => void;
}

type SourceUrlPart = { type: 'source-url'; url: string; title?: string };

function sourceTitle(part: SourceUrlPart): string {
  return part.title || part.url;
}

function MessageItemImpl({ message, isFirst, isLast, prevRole, status, toolRenderers, actionRenderers, onRegenerate, onToolApproval, feedbackEnabled, conversationId, feedbackApiBase, feedbackHeaders, onFeedback }: MessageItemProps) {
  const sourceParts = useMemo(
    () => (message.parts?.filter((part) => part.type === 'source-url') ?? []) as SourceUrlPart[],
    [message.parts],
  );
  const fileParts = useMemo(
    () => message.parts?.filter((part) => part.type === 'file') ?? [],
    [message.parts],
  );
  const attachments = useMemo(
    () =>
      fileParts.map((part) => ({
        filename: (part as { filename?: string }).filename || 'unknown',
        mediaType: (part as { mediaType?: string }).mediaType as string,
        url: (part as { url?: string }).url as string,
        size: (part as { size?: number }).size || 0,
      })),
    [fileParts],
  );

  const isStreamingThisMessage = isLast && message.role === 'assistant' && status !== 'ready';
  const showActions = message.role === 'assistant' && !isStreamingThisMessage;
  const showRegenerate = showActions && isLast && status === 'ready';
  const messageText = useMemo(
    () =>
      showActions
        ? (message.parts ?? [])
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('\n\n')
        : '',
    [showActions, message.parts],
  );

  const turnState: TurnState =
    status === 'error' ? 'error' : isStreamingThisMessage ? 'streaming' : 'done';

  const spacing = isFirst
    ? undefined
    : message.role === 'assistant' && prevRole === 'user'
      ? 'mt-4'
      : 'mt-6';

  return (
    <div className={cn('group relative', spacing)}>
      {message.role === 'assistant' && sourceParts.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceParts.length} />
          <SourcesContent>
            {sourceParts.map((part, i) => (
              <Source
                key={`${message.id}-source-${i}`}
                href={part.url}
                title={sourceTitle(part)}
                index={i}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {fileParts.length > 0 && (
        <div className={cn('flex mb-1', message.role === 'user' ? 'justify-end' : 'justify-start')}>
          <MessageAttachments attachments={attachments} />
        </div>
      )}

      {message.parts ? (
        message.role === 'assistant' ? (
          <>
            <AgentTurnTranscript
              message={message}
              isLast={isLast}
              isStreaming={status === 'streaming'}
              turn={turnState}
              toolRenderers={toolRenderers}
              actionRenderers={actionRenderers}
              onToolApproval={onToolApproval}
            />
            {!isStreamingThisMessage && sourceParts.length > 0 && (
              <MessageMetadata items={[`Grounded in ${sourceParts.length} source${sourceParts.length === 1 ? '' : 's'}`]} />
            )}
          </>
        ) : (
          <div className="space-y-2">
            {message.parts.map((part, i) =>
              part.type === 'text' ? (
                <Fragment key={`${message.id}-${i}`}>
                  <Message from="user">
                    <MessageContent>
                      <Response>{part.text}</Response>
                    </MessageContent>
                  </Message>
                </Fragment>
              ) : null,
            )}
          </div>
        )
      ) : (
        <Fragment key={`${message.id}-content`}>
          <Message from={message.role}>
            <MessageContent>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Response>{(message as any).content || (message as any).text}</Response>
            </MessageContent>
          </Message>
        </Fragment>
      )}

      {showActions && (
        <MessageActions
          text={messageText}
          onRegenerate={showRegenerate ? onRegenerate : undefined}
          alwaysVisible={isLast}
          feedbackEnabled={feedbackEnabled}
          messageId={message.id}
          conversationId={conversationId}
          feedbackApiBase={feedbackApiBase}
          feedbackHeaders={feedbackHeaders}
          onFeedback={onFeedback}
        />
      )}
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);

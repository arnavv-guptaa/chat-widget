import { Fragment, memo, useMemo } from 'react';
import type { UIMessage, ChatStatus } from 'ai';
import { cn } from '../utils/cn';
import { Message, MessageContent } from './message';
import { Response } from './response';
import { Source, Sources, SourcesContent, SourcesTrigger } from './sources';
import { MessageAttachments } from './message-attachments';
import { MessageActions } from './message-actions';
import { AgentTurnTranscript } from './transcript/AgentTurnTranscript';
import type { TurnState } from './transcript/types';
import type { ActionRenderer, ToolRenderer } from '../types';

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
  /** First message in the list? (drives top spacing — first has no mt). */
  isFirst: boolean;
  /** Is this the last message in the list? (drives streaming + regenerate UI) */
  isLast: boolean;
  /** Role of the previous message — drives role-aware spacing: a new exchange
   *  (user after assistant) gets a larger gap; an assistant reply to its user
   *  sits tighter, so each Q&A reads as a pair. */
  prevRole?: UIMessage['role'];
  /** Chat status — primitive; flips only at stream start/end. */
  status: ChatStatus;
  /** Host-supplied per-tool renderers (stable: memoized in ChatWidget config). */
  toolRenderers?: Record<string, ToolRenderer>;
  /** Host-supplied declarative action-result cards (#166). */
  actionRenderers?: Record<string, ActionRenderer>;
  /** Stable regenerate handler (only used on the last assistant message). */
  onRegenerate?: () => void;
  /** Approve/deny a paused (needsApproval) tool call. */
  onToolApproval?: (approvalId: string, approved: boolean) => void;
}

function MessageItemImpl({ message, isFirst, isLast, prevRole, status, toolRenderers, actionRenderers, onRegenerate, onToolApproval }: MessageItemProps) {
  // Derive part subsets once per message (recomputed only when parts change).
  const sourceParts = useMemo(
    () => message.parts?.filter((part) => part.type === 'source-url') ?? [],
    [message.parts],
  );
  const fileParts = useMemo(
    () => message.parts?.filter((part) => part.type === 'file') ?? [],
    [message.parts],
  );
  // Stable attachments array so the memoized MessageAttachments can bail out
  // (the old call site rebuilt new object literals every render, defeating memo).
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

  // Collapse the AI SDK status to the three-state turn lifecycle the transcript
  // consumes. 'error' when the SDK reports it; 'streaming' while this is the
  // live last assistant message; otherwise 'done'.
  const turnState: TurnState =
    status === 'error' ? 'error' : isStreamingThisMessage ? 'streaming' : 'done';

  // Role-aware spacing (assistant-ui rhythm): the assistant's reply sits CLOSE
  // to the user message it answers (one exchange), while a NEW user turn after
  // an assistant reply gets a LARGER gap to separate exchanges. First message
  // has no top margin.
  const spacing = isFirst
    ? undefined
    : message.role === 'assistant' && prevRole === 'user'
      ? 'mt-4' // reply to a question — keep the pair tight (16px)
      : 'mt-6'; // new exchange — a touch more room (24px), matching assistant-ui

  return (
    // `group` so the action row can reveal on hover; `relative` so the
    // absolutely-positioned action row anchors to this message and floats in the
    // gap below it (instead of adding height).
    <div className={cn('group relative', spacing)}>
      {/* Sources — all inside one SourcesContent (Radix Collapsible wants a
          single Content child to toggle). */}
      {message.role === 'assistant' && sourceParts.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceParts.length} />
          <SourcesContent>
            {sourceParts.map((part, i) => (
              <Source
                key={`${message.id}-source-${i}`}
                href={(part as { url: string }).url}
                title={(part as { url: string }).url}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {/* File attachments above the message */}
      {fileParts.length > 0 && (
        <div className={cn('flex mb-1', message.role === 'user' ? 'justify-end' : 'justify-start')}>
          <MessageAttachments attachments={attachments} />
        </div>
      )}

      {message.parts ? (
        message.role === 'assistant' ? (
          // Assistant turns render through the transcript: in-order text,
          // compact tool rows, thinking disclosure, planning shimmer.
          <AgentTurnTranscript
            message={message}
            isLast={isLast}
            isStreaming={status === 'streaming'}
            turn={turnState}
            toolRenderers={toolRenderers}
            actionRenderers={actionRenderers}
            onToolApproval={onToolApproval}
          />
        ) : (
          // User turns: plain text parts in the user bubble.
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

      {/* Action row — Copy on every completed assistant message; Regenerate
          only on the last (it replays the most recent turn). Hidden by default
          and revealed on hover/focus of the message; the LAST message keeps them
          visible (copy/regen are most-used on the newest reply). */}
      {showActions && (
        <MessageActions
          text={messageText}
          onRegenerate={showRegenerate ? onRegenerate : undefined}
          alwaysVisible={isLast}
        />
      )}
    </div>
  );
}

// DEFAULT shallow compare — see the WHY block above. No custom comparator.
export const MessageItem = memo(MessageItemImpl);

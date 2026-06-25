import { Fragment, memo, useMemo } from 'react';
import type { UIMessage } from 'ai';
import { Message, MessageContent } from '../message';
import { Response } from '../response';
import { AgentToolCall } from './AgentToolCall';
import { AgentThinkingTool } from './AgentThinkingTool';
import { TextShimmer } from './TextShimmer';
import {
  getResultSummary,
  getToolStatus,
  getToolSubtitle,
  getToolVerb,
  pickPlanningVerb,
} from './toolRegistry';
import { toToolPart, type ToolPart, type TurnState } from './types';
import type { ToolRenderer } from '../../types';

/**
 * Renders one assistant turn as a clean, in-order flow — text, reasoning, and
 * tool calls in the sequence they happened. NO step-grouping / "N steps"
 * folding (that's an agent dev-log pattern; an assistant shows its work inline
 * and reassuringly). Each tool is a compact AgentToolCall row; reasoning is the
 * AgentThinkingTool disclosure; the gap before the first token shows a warm
 * planning shimmer.
 */
interface AgentTurnTranscriptProps {
  message: UIMessage;
  isLast: boolean;
  isStreaming: boolean;
  turn: TurnState;
  toolRenderers?: Record<string, ToolRenderer>;
}

const MUTED = { color: 'hsl(var(--chat-text-muted))' } as const;

type RenderPart =
  | { kind: 'text'; id: string; text: string; idx: number }
  | { kind: 'reasoning'; id: string; text: string; idx: number }
  | { kind: 'tool'; id: string; tool: ToolPart; idx: number };

function AgentTurnTranscriptImpl({
  message,
  isLast,
  isStreaming,
  turn,
  toolRenderers,
}: AgentTurnTranscriptProps) {
  const turnId = message.id;

  const flat = useMemo<RenderPart[]>(() => {
    const out: RenderPart[] = [];
    (message.parts ?? []).forEach((part, i) => {
      if (part.type === 'text') {
        out.push({ kind: 'text', id: `${turnId}-${i}`, text: part.text, idx: i });
      } else if (part.type === 'reasoning') {
        out.push({
          kind: 'reasoning',
          id: `${turnId}-${i}`,
          text: (part as { text: string }).text,
          idx: i,
        });
      } else if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tp = toToolPart(part as any, `${turnId}-${i}`);
        out.push({ kind: 'tool', id: tp.id, tool: tp, idx: i });
      }
    });
    return out;
  }, [message.parts, turnId]);

  const lastIdx = flat.length - 1;
  const shouldShowPlanning = isLast && isStreaming && flat.length === 0;
  const planningVerb = useMemo(() => pickPlanningVerb(turnId), [turnId]);

  return (
    <div className="flex flex-col gap-1.5" data-assistant-turn-id={turnId}>
      {flat.map((item, i) => {
        const isItemLast = i === lastIdx;
        if (item.kind === 'text') {
          if (!item.text.trim()) return null;
          const isTextStreaming = isStreaming && isLast && isItemLast;
          return (
            <Fragment key={item.id}>
              <Message from="assistant">
                <MessageContent>
                  <Response isStreaming={isTextStreaming}>{item.text}</Response>
                </MessageContent>
              </Message>
            </Fragment>
          );
        }
        if (item.kind === 'reasoning') {
          const isReasoningStreaming = isStreaming && isLast && isItemLast;
          return (
            <AgentThinkingTool
              key={item.id}
              text={item.text}
              turn={turn}
              isStreaming={isReasoningStreaming}
            />
          );
        }
        // tool
        const part = item.tool;
        const custom = toolRenderers?.[part.tool];
        if (custom) {
          const rendered = custom({
            type: `tool-${part.tool}`,
            toolName: part.tool,
            toolCallId: part.id,
            state: part.state.status,
            input: part.state.input,
            output: part.state.output,
            errorText: part.state.errorText,
          });
          if (rendered != null) return <Fragment key={item.id}>{rendered}</Fragment>;
        }
        const status = getToolStatus(part, turn);
        const verb = getToolVerb(part.tool, status.isPending);
        // While running show the input subtitle; once done prefer a result summary.
        const subtitle = status.isPending
          ? getToolSubtitle(part)
          : getResultSummary(part) || getToolSubtitle(part);
        const detail =
          part.state.output != null
            ? typeof part.state.output === 'string'
              ? part.state.output
              : JSON.stringify(part.state.output, null, 2)
            : undefined;
        return (
          <AgentToolCall
            key={item.id}
            verb={verb}
            subtitle={subtitle}
            isPending={status.isPending}
            isError={status.isError}
            detail={detail}
            errorText={part.state.errorText}
          />
        );
      })}

      {shouldShowPlanning && (
        <div className="flex items-center gap-2 px-2 py-1 -mx-2">
          <span className="chat-status-dot is-running" aria-hidden="true" />
          <TextShimmer as="span" className="text-[13px] font-medium leading-5">
            {planningVerb}
          </TextShimmer>
        </div>
      )}
    </div>
  );
}

export const AgentTurnTranscript = memo(AgentTurnTranscriptImpl);

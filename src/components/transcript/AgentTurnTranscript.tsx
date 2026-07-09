import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
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
import type { ActionRenderer, ToolRenderer, UiRenderer } from '../../types';
import type { MordnActionDispatcher } from '../../actions/types';
import { ActionResultCard } from '../action-result-card';
import { MordnGuiPart, canRenderGui } from '../gui-part';

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
  actionRenderers?: Record<string, ActionRenderer>;
  uiRenderers?: Record<string, UiRenderer>;
  onAction?: MordnActionDispatcher;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
}

const MUTED = { color: 'hsl(var(--chat-text-muted))' } as const;

type RenderPart =
  | { kind: 'text'; id: string; text: string; idx: number }
  | { kind: 'reasoning'; id: string; text: string; idx: number }
  | { kind: 'tool'; id: string; tool: ToolPart; idx: number }
  | { kind: 'gui'; id: string; spec: unknown; idx: number };

/** The AI SDK data-part type that carries a generative-GUI spec. */
const GUI_DATA_PART = 'data-mordn-ui';
/** Tool name whose output is a generative-GUI spec (rendered via the built-in path). */
const GUI_TOOL_NAME = 'mordn_ui';

/**
 * Resolve a GUI spec to a node: a host `uiRenderers[kind]` wins (returning null
 * to defer), otherwise the built-in {@link MordnGuiPart} maps it to a primitive.
 * Returns null when nothing can render it (unknown/ malformed spec), so callers
 * treat null as "render nothing".
 */
function renderGui(
  spec: unknown,
  uiRenderers: Record<string, UiRenderer> | undefined,
  onAction: MordnActionDispatcher | undefined,
): ReactNode {
  const kind =
    spec && typeof spec === 'object' && !Array.isArray(spec)
      ? (spec as { kind?: unknown }).kind
      : undefined;
  // Host renderer for this kind wins; returning null defers to the built-in.
  if (typeof kind === 'string' && uiRenderers?.[kind]) {
    const custom = uiRenderers[kind](spec, onAction);
    if (custom != null) return custom;
  }
  // Only render the built-in for kinds it actually knows, so an unknown-kind
  // spec falls through (null) — e.g. a `mordn_ui` tool can then show the default
  // tool row instead of an empty node.
  if (canRenderGui(spec)) return <MordnGuiPart spec={spec} onAction={onAction} />;
  return null;
}

function AgentTurnTranscriptImpl({
  message,
  isLast,
  isStreaming,
  turn,
  toolRenderers,
  actionRenderers,
  uiRenderers,
  onAction,
  onToolApproval,
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
      } else if (part.type === GUI_DATA_PART) {
        // Generative-GUI data part: the assistant streamed a UI spec directly
        // (no tool call). `data` holds the MordnGuiSpec; render it as a GUI part.
        const data = (part as { data?: unknown }).data;
        out.push({ kind: 'gui', id: `${turnId}-${i}`, spec: data, idx: i });
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
        if (item.kind === 'gui') {
          // Generative-GUI part (from a `data-mordn-ui` data part). A host
          // uiRenderer for the spec's kind wins; else the built-in MordnGuiPart
          // maps it to a primitive. Either returning null renders nothing.
          const node = renderGui(item.spec, uiRenderers, onAction);
          return node ? <Fragment key={item.id}>{node}</Fragment> : null;
        }
        // tool
        const part = item.tool;
        // Generative-GUI tool: an assistant tool named `mordn_ui` whose output is
        // a GUI spec. Render it through the same GUI path (host uiRenderer → built-in),
        // but only once the output is available so a streaming call shows nothing yet.
        if (part.tool === GUI_TOOL_NAME) {
          if (part.state.status === 'output-available') {
            const node = renderGui(part.state.output, uiRenderers, onAction);
            if (node) return <Fragment key={item.id}>{node}</Fragment>;
          }
          return null;
        }
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
        // Declarative action card (#166) — runs after full-JSX toolRenderers,
        // before the default row. Reflects the REAL outcome (success / partial /
        // error), so a model's confident "Done!" can't hide a failed step.
        const action = actionRenderers?.[part.tool];
        if (action) {
          const result = action({
            type: `tool-${part.tool}`,
            toolName: part.tool,
            toolCallId: part.id,
            state: part.state.status,
            input: part.state.input,
            output: part.state.output,
            errorText: part.state.errorText,
          });
          if (result != null) {
            return (
              <Fragment key={item.id}>
                <ActionResultCard {...result} />
              </Fragment>
            );
          }
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
        // Human-in-the-loop: a tool paused awaiting approval shows Approve/Deny
        // (unless a policy already auto-approved it). onApprove resumes the turn.
        const awaitingApproval =
          part.state.status === 'approval-requested' &&
          !!part.approval &&
          !part.approval.isAutomatic;
        return (
          <AgentToolCall
            key={item.id}
            verb={verb}
            subtitle={subtitle}
            isPending={status.isPending}
            isError={status.isError}
            detail={detail}
            errorText={part.state.errorText}
            awaitingApproval={awaitingApproval}
            onApprove={
              awaitingApproval && onToolApproval && part.approval
                ? (approved) => onToolApproval(part.approval!.id, approved)
                : undefined
            }
          />
        );
      })}

      {shouldShowPlanning && (
        <div className="flex items-center gap-2 px-2 py-1 -mx-2">
          <Loader2
            className="size-3.5 flex-shrink-0 animate-spin"
            style={{ color: 'hsl(var(--chat-text-subtle))' }}
            aria-hidden="true"
          />
          <TextShimmer as="span" className="text-[13px] font-medium leading-5">
            {planningVerb}
          </TextShimmer>
        </div>
      )}
    </div>
  );
}

export const AgentTurnTranscript = memo(AgentTurnTranscriptImpl);

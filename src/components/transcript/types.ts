import type { ToolPartLike } from '../../types';

/**
 * Lifecycle of the assistant turn this part belongs to. The widget exposes the
 * AI SDK ChatStatus at the message level; we collapse it to three states.
 */
export type TurnState = 'streaming' | 'done' | 'error';

/** Normalised tool part: the widget's ToolPartLike adapted to { id, tool, state }. */
export interface ToolPart {
  id: string;
  tool: string;
  state: {
    status: ToolPartLike['state'];
    input: Record<string, unknown>;
    output?: unknown;
    errorText?: string;
  };
  /** Carried from the SDK part — set when status is 'approval-requested'. */
  approval?: { id: string; isAutomatic?: boolean };
}

export interface ToolStatus {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isInterrupted: boolean;
}

export function toToolPart(raw: ToolPartLike, fallbackId: string): ToolPart {
  const tool =
    raw.toolName ?? (raw.type.startsWith('tool-') ? raw.type.slice(5) : raw.type);
  return {
    id: raw.toolCallId || fallbackId,
    tool,
    state: {
      status: raw.state,
      input: (raw.input as Record<string, unknown>) ?? {},
      output: raw.output,
      errorText: raw.errorText,
    },
    approval: raw.approval,
  };
}

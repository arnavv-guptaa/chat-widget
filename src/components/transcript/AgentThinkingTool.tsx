import { ChevronRight } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { Response } from '../response';
import { TextShimmer } from './TextShimmer';
import type { TurnState } from './types';

const PREVIEW_LENGTH = 60;
const SCROLL_THRESHOLD = 400;

interface AgentThinkingToolProps {
  text: string;
  turn: TurnState;
  isStreaming: boolean;
}

const MUTED = { color: 'hsl(var(--chat-text-muted))' } as const;
const SUBTLE = { color: 'hsl(var(--chat-text-subtle))' } as const;
const FADE_BG = {
  backgroundImage: 'linear-gradient(to bottom, hsl(var(--chat-background)), transparent)',
} as const;

function AgentThinkingToolImpl({ text, turn, isStreaming }: AgentThinkingToolProps) {
  const isActivelyStreaming = turn !== 'done' && turn !== 'error';
  const isPending = isStreaming && isActivelyStreaming;

  // Open while actively thinking; auto-collapse the moment it settles.
  const [isExpanded, setIsExpanded] = useState(isPending);
  const wasPendingRef = useRef(isPending);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wasPendingRef.current && !isPending) setIsExpanded(false);
    wasPendingRef.current = isPending;
  }, [isPending]);

  const thinkingText = text || '';

  useEffect(() => {
    if (isPending && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingText, isPending, isExpanded]);

  if (!thinkingText && !isPending) return null;

  const previewText = thinkingText.slice(0, PREVIEW_LENGTH).replace(/\n/g, ' ');
  const longBody = thinkingText.length > SCROLL_THRESHOLD;

  return (
    <div className="select-text">
      <div
        onClick={() => setIsExpanded((v) => !v)}
        className="group/think flex items-center gap-2 rounded-md px-2 py-1 -mx-2 cursor-pointer transition-colors hover:bg-[var(--chat-hover-bg)]"
      >
        <div className="flex items-baseline gap-1.5 min-w-0 text-[13px] leading-5">
          {isPending ? (
            <TextShimmer as="span" className="font-medium whitespace-nowrap flex-shrink-0">
              Thinking
            </TextShimmer>
          ) : (
            <span className="font-medium whitespace-nowrap flex-shrink-0" style={MUTED}>
              Thought it through
            </span>
          )}
          {!isExpanded && previewText && (
            <span className="truncate min-w-0" style={SUBTLE}>
              {previewText}
              {thinkingText.length > PREVIEW_LENGTH && '…'}
            </span>
          )}
        </div>
        <ChevronRight
          className={cn(
            'ml-auto w-3.5 h-3.5 flex-shrink-0 transition-all duration-200 ease-out',
            isExpanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/think:opacity-100',
          )}
          style={SUBTLE}
        />
      </div>

      {isExpanded && thinkingText && (
        <div className="relative chat-tool-detail">
          {isPending && longBody && (
            <div className="absolute inset-x-0 top-0 h-5 z-10 pointer-events-none" style={FADE_BG} />
          )}
          <div
            ref={scrollRef}
            className={cn('px-2 text-[13px] leading-relaxed', isPending && longBody && 'overflow-y-auto scrollbar-hide max-h-28')}
            style={MUTED}
          >
            <Response className="text-[13px]" isStreaming={isPending}>
              {thinkingText}
            </Response>
            {isPending && <span className="chat-caret" aria-hidden="true" />}
          </div>
        </div>
      )}
    </div>
  );
}

export const AgentThinkingTool = memo(AgentThinkingToolImpl);

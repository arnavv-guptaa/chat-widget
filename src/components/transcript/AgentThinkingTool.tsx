import { ChevronRight } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { Response } from '../response';
import { TextShimmer } from './TextShimmer';
import type { TurnState } from './types';

const SCROLL_THRESHOLD = 400;

interface AgentThinkingToolProps {
  text: string;
  turn: TurnState;
  isStreaming: boolean;
}

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

  const longBody = thinkingText.length > SCROLL_THRESHOLD;

  return (
    <div className="select-text">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Hide reasoning' : 'Show reasoning'}
        onClick={() => setIsExpanded((v) => !v)}
        onKeyDown={(e) => {
          // A disclosure must be operable by keyboard: Enter and Space toggle it
          // (Space is preventDefault-ed so the page doesn't scroll).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((v) => !v);
          }
        }}
        className="group/think inline-flex items-center gap-1.5 rounded-md py-0.5 cursor-pointer text-[12.5px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.28)]"
      >
        {isPending ? (
          <TextShimmer as="span" className="font-medium whitespace-nowrap">
            Thinking
          </TextShimmer>
        ) : (
          <span className="font-medium whitespace-nowrap transition-colors group-hover/think:text-[hsl(var(--chat-text-muted))]" style={SUBTLE}>
            Thought it through
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 ease-out',
            isExpanded && 'rotate-90',
          )}
          style={SUBTLE}
          strokeWidth={1.6}
        />
      </div>

      {isExpanded && thinkingText && (
        <div className="relative chat-tool-detail ml-2 mt-1 border-l-2 border-[hsl(var(--chat-border))] pl-3">
          {isPending && longBody && (
            <div className="absolute inset-x-0 top-0 h-5 z-10 pointer-events-none" style={FADE_BG} />
          )}
          <div
            ref={scrollRef}
            className={cn('text-[12.5px] italic leading-relaxed text-[hsl(var(--chat-text-faint))]', isPending && longBody && 'overflow-y-auto scrollbar-hide max-h-28')}
          >
            <Response className="text-[12.5px]" isStreaming={isPending}>
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

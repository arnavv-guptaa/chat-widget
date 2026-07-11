'use client';

import { ChevronRight } from 'lucide-react';

/**
 * Follow-up suggestions as a "Related" block — a quiet labeled list of
 * stacked, full-width rows (Perplexity-style), replacing the old horizontally
 * scrolling pill row which truncated questions and hid all but the first
 * suggestion at widget widths.
 *
 * Rendered inside the conversation, attached under the completed assistant
 * reply, so it reads as part of the answer and scrolls away with it. Rows use
 * the same divider/ink ramp as the rest of the widget: muted at rest,
 * full text + a nudged chevron on hover.
 */
export function FollowUpSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-4" data-follow-up-suggestions>
      <div
        className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: 'hsl(var(--chat-text-subtle))' }}
      >
        Related
      </div>
      <div>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className="group flex w-full items-center justify-between gap-3 border-t px-2 py-2.5 text-left text-[13px] leading-5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chat-primary)/0.4)]"
            style={{ borderColor: 'hsl(var(--chat-border))' }}
          >
            <span
              className="min-w-0 transition-colors"
              style={{ color: 'hsl(var(--chat-text-muted))' }}
              // Step up the ink ramp on hover — same pattern as tab titles.
              onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--chat-text))'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--chat-text-muted))'; }}
            >
              {s}
            </span>
            <ChevronRight
              className="size-3.5 flex-shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
              style={{ color: 'hsl(var(--chat-text-subtle))' }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

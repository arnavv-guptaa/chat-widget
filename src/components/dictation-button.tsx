import { MicIcon, MicOffIcon } from 'lucide-react';

import type { DictationApi } from '../hooks/use-dictation';
import { cn } from '../utils/cn';
import { PromptInputButton } from './prompt-input';

/**
 * Microphone toggle in the composer action row — same 32px ghost icon-button
 * recipe as `AttachButton`. Renders nothing when the browser has no speech
 * recognition, so an unsupported browser looks exactly like before.
 *
 * Module-scope on purpose (never define a component inside `ChatInterface`).
 */
export function DictationButton({ dictation }: { dictation: DictationApi }) {
  if (!dictation.supported) return null;

  const { state } = dictation;
  const active = state === 'listening' || state === 'requesting';
  const denied = state === 'denied';

  const label = denied
    ? 'Microphone access is blocked — allow it in your browser settings'
    : active
      ? 'Stop dictation'
      : 'Start dictation';

  return (
    <>
      <PromptInputButton
        variant="ghost"
        size="icon"
        tooltip={label}
        aria-label={label}
        aria-pressed={active}
        aria-disabled={denied || undefined}
        data-dictation-state={state}
        onClick={() => {
          if (denied) return;
          dictation.toggle();
        }}
        className={cn(
          // Quiet icon button at rest (mirrors AttachButton).
          'size-8 rounded-[7px] text-[hsl(var(--chat-text-faint))] hover:bg-[hsl(var(--chat-hover-bg))] hover:text-[hsl(var(--chat-text))]',
          // Permission prompt up: mid-tone, no pulse yet.
          state === 'requesting' && 'text-[hsl(var(--chat-text-muted))]',
          // Listening: primary mic on the primary tint disc + pulsing ring (CSS).
          state === 'listening' &&
            'chat-dictation-active bg-[hsl(var(--chat-primary-tint))] text-[hsl(var(--chat-primary))] hover:bg-[hsl(var(--chat-primary-tint))] hover:text-[hsl(var(--chat-primary))]',
          denied && 'cursor-not-allowed text-[hsl(var(--chat-text-subtle))] hover:bg-transparent hover:text-[hsl(var(--chat-text-subtle))]',
        )}
      >
        {denied ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
      </PromptInputButton>
      {/* Screen-reader status; the visual state lives on the button. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'requesting' ? 'Waiting for microphone permission' : state === 'listening' ? 'Listening' : ''}
      </span>
    </>
  );
}

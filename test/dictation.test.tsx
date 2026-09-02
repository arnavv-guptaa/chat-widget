/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DictationButton } from '../src/components/dictation-button';
import { useDictation } from '../src/hooks/use-dictation';
import type { SpeechRecognitionErrorEventLike, SpeechRecognitionEventLike } from '../src/utils/speech-recognition';

/**
 * A scriptable stand-in for the browser recognizer. Tests drive it directly:
 * `emit([[transcript, isFinal], …])`, `fail(code)`, `end()`.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: ((e: unknown) => void) | null = null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: ((e: unknown) => void) | null = null;
  start = vi.fn(() => this.onstart?.({}));
  stop = vi.fn(() => this.onend?.({}));
  abort = vi.fn(() => this.onend?.({}));
  constructor() {
    FakeRecognition.instances.push(this);
  }
  emit(items: Array<[string, boolean]>) {
    const results = items.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript, confidence: 1 } }));
    this.onresult?.({ resultIndex: 0, results: { length: results.length, ...results } as never });
  }
  fail(code: string) {
    this.onerror?.({ error: code });
  }
}
const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

function Harness({ enabled = true, lang }: { enabled?: boolean; lang?: string }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const dictation = useDictation({ textareaRef: ref, value, setValue, enabled, lang });
  return (
    <>
      <textarea
        ref={ref}
        data-testid="ta"
        value={value}
        placeholder={dictation.state === 'listening' && !value ? 'Listening…' : 'Ask anything…'}
        onChange={(e) => {
          dictation.onManualEdit();
          setValue(e.target.value);
        }}
        onKeyDown={dictation.onKeyDown}
      />
      {enabled && <DictationButton dictation={dictation} />}
      {dictation.notice && <div role="alert">{dictation.notice}</div>}
    </>
  );
}

const textarea = () => screen.getByTestId('ta') as HTMLTextAreaElement;
// The harness renders exactly one button; its accessible name changes with
// state ("Start dictation" / "Stop dictation" / "Microphone access is blocked…").
const button = () => screen.getByRole('button');

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
  document.documentElement.lang = 'en-GB';
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  document.documentElement.lang = '';
});

describe('DictationButton / useDictation', () => {
  it('renders nothing when the browser has no SpeechRecognition', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Harness />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders via the webkit-prefixed constructor too', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    render(<Harness />);
    expect(button()).toHaveProperty('ariaPressed', 'false');
  });

  it('starts a continuous, interim session in the page language and toggles state', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    expect(r.continuous).toBe(true);
    expect(r.interimResults).toBe(true);
    expect(r.lang).toBe('en-GB');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('aria-label')).toBe('Stop dictation');
    expect(textarea().placeholder).toBe('Listening…');

    fireEvent.click(button());
    expect(r.stop).toHaveBeenCalledTimes(1);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('prefers an explicit language override', () => {
    render(<Harness lang="de-DE" />);
    fireEvent.click(button());
    expect(latest().lang).toBe('de-DE');
  });

  it('shows interim text inline, commits finals with join rules, and drops the interim tail on stop', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();

    act(() => r.emit([['hello', false]]));
    expect(textarea().value).toBe('Hello');

    act(() => r.emit([['hello there', true], ['how are', false]]));
    expect(textarea().value).toBe('Hello there how are');

    act(() => r.stop());
    expect(textarea().value).toBe('Hello there');
  });

  it('inserts at the caret, keeping text on both sides', () => {
    render(<Harness />);
    const ta = textarea();
    fireEvent.change(ta, { target: { value: 'Before after' } });
    ta.setSelectionRange(6, 6);
    fireEvent.click(button());
    act(() => latest().emit([['the middle', true]]));
    expect(ta.value).toBe('Before the middle after');
  });

  it('a manual edit ends the session and the recognizer never overwrites the edit', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    act(() => r.emit([['hello', true], ['wor', false]]));
    expect(textarea().value).toBe('Hello wor');

    fireEvent.change(textarea(), { target: { value: 'Hello world!' } });
    expect(r.stop).toHaveBeenCalledTimes(1);
    // `onend` ran inside stop(); the user's text must survive it.
    expect(textarea().value).toBe('Hello world!');
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('Escape stops dictation but is left alone when another handler claimed it', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(r.stop).toHaveBeenCalledTimes(1);

    fireEvent.click(button());
    const r2 = latest();
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    evt.preventDefault(); // someone upstream (e.g. an open plugin panel) took it
    act(() => {
      textarea().dispatchEvent(evt);
    });
    expect(r2.stop).not.toHaveBeenCalled();
  });

  it('a permission denial becomes a sticky blocked state', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    act(() => {
      r.fail('not-allowed');
      r.onend?.({});
    });
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().getAttribute('aria-label')).toMatch(/blocked/);
    fireEvent.click(button());
    expect(FakeRecognition.instances).toHaveLength(1); // no new session attempted
    expect(screen.queryByRole('alert')).toBeNull(); // no redundant notice
  });

  it('transient failures surface an inline notice and return to idle', () => {
    render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    act(() => {
      r.fail('network');
      r.onend?.({});
    });
    expect(screen.getByRole('alert').textContent).toMatch(/internet/);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    // Starting again clears the stale notice, and a silence timeout is a
    // normal end, not an error — so no notice at all after this session.
    fireEvent.click(button());
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      latest().fail('no-speech');
      latest().onend?.({});
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('aborts the session on unmount', () => {
    const view = render(<Harness />);
    fireEvent.click(button());
    const r = latest();
    view.unmount();
    expect(r.abort).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the feature is disabled', () => {
    render(<Harness enabled={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

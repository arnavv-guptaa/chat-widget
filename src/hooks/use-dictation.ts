import { useCallback, useEffect, useRef, useState } from 'react';

import {
  classifyDictationError,
  composeDictation,
  dictationNotice,
  foldDictationResults,
  getSpeechRecognition,
  resolveDictationLanguage,
  type SpeechRecognitionLike,
} from '../utils/speech-recognition';

/**
 * Composer dictation on the browser's built-in `SpeechRecognition`.
 *
 * Speak → words land in the textarea at the caret → the user edits and sends
 * like any typed message. This is dictation, not voice mode: nothing is ever
 * auto-sent, no audio is played back, and no audio passes through the host or
 * mordn — the recognizer is the browser's own (Chrome/Safari may hand audio to
 * Google/Apple speech services; that is the browser's contract, not ours).
 *
 * Shape mirrors `useInputPlugins`: same `textareaRef` / `value` / `setValue`
 * inputs, same "set the value, then restore the caret on the next tick" idiom
 * for insertion.
 *
 * State machine: idle → requesting (start() called, permission prompt may be
 * up) → listening → idle. `denied` is sticky for the mount: the browser will
 * keep refusing until the user changes site permissions, so the button shows
 * a blocked state instead of failing on every tap.
 */

export type DictationState = 'idle' | 'requesting' | 'listening' | 'denied';

export interface UseDictationOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (next: string) => void;
  /** `features.voiceInput` — false renders nothing and makes every action a no-op. */
  enabled: boolean;
  /** `features.voiceInputLanguage` — BCP-47; falls back to page, then browser language. */
  lang?: string;
}

export interface DictationApi {
  /** False on the server and in browsers without the API; the button renders nothing. */
  supported: boolean;
  state: DictationState;
  /** Inline notice for a transient failure (offline, no microphone). */
  notice: string | null;
  clearNotice: () => void;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /**
   * Call from the textarea's onChange (typing, paste, cut). Any manual edit
   * ends the session — merging live edits with a moving interim span produces
   * caret jumps and duplicated words. What is on screen stays as the user
   * left it; restarting is one tap.
   */
  onManualEdit: () => void;
  /** Escape stops dictation. Skips events another handler already claimed. */
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useDictation({ textareaRef, value, setValue, enabled, lang }: UseDictationOptions): DictationApi {
  // Feature-detect after mount so server and first client render agree
  // (no hydration mismatch) and SSR never touches `window`.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const [state, setState] = useState<DictationState>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  // Text around the selection when the session started; dictation is
  // inserted between them.
  const snapshotRef = useRef<{ before: string; after: string }>({ before: '', after: '' });
  const committedRef = useRef('');
  // Set when the user edited manually mid-session: the recognizer's final
  // `onend` must then leave the text alone rather than re-render a stale span.
  const detachedRef = useRef(false);
  const stateRef = useRef<DictationState>('idle');
  stateRef.current = state;

  const placeCaret = useCallback(
    (caret: number) => {
      setTimeout(() => {
        const t = textareaRef.current;
        if (!t) return;
        try {
          t.setSelectionRange(caret, caret);
        } catch {
          // Some browsers throw on setSelectionRange in certain states.
        }
      }, 0);
    },
    [textareaRef],
  );

  const render = useCallback(
    (committed: string, interim: string) => {
      if (detachedRef.current) return;
      const { before, after } = snapshotRef.current;
      const next = composeDictation(before, committed, interim, after);
      setValue(next.value);
      placeCaret(next.caret);
    },
    [setValue, placeCaret],
  );

  const stop = useCallback(() => {
    const r = recognizerRef.current;
    if (!r) return;
    try {
      r.stop(); // `onend` finalizes: drops the interim tail, resets state.
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    if (!enabled) return;
    if (recognizerRef.current) return; // already requesting/listening
    if (stateRef.current === 'denied') return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    const ta = textareaRef.current;
    const selStart = ta?.selectionStart ?? value.length;
    const selEnd = ta?.selectionEnd ?? value.length;
    snapshotRef.current = { before: value.slice(0, selStart), after: value.slice(selEnd) };
    committedRef.current = '';
    detachedRef.current = false;
    setNotice(null);

    const recognizer = new Ctor();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    const language = resolveDictationLanguage(lang);
    if (language) recognizer.lang = language;

    recognizer.onstart = () => setState('listening');
    recognizer.onresult = (event) => {
      const { committed, interim } = foldDictationResults(snapshotRef.current.before, event.results);
      committedRef.current = committed;
      render(committed, interim);
    };
    recognizer.onerror = (event) => {
      const kind = classifyDictationError(event.error);
      if (kind === 'denied') {
        setState('denied');
        return; // `onend` follows and cleans up; state stays denied.
      }
      const message = dictationNotice(kind);
      if (message) setNotice(message);
    };
    recognizer.onend = () => {
      recognizerRef.current = null;
      // Commit what the browser confirmed; the unconfirmed interim tail goes.
      render(committedRef.current, '');
      setState((s) => (s === 'denied' ? 'denied' : 'idle'));
    };

    recognizerRef.current = recognizer;
    setState('requesting');
    try {
      recognizer.start();
    } catch {
      // Chrome throws InvalidStateError if a session is already running.
      recognizerRef.current = null;
      setState('idle');
    }
  }, [enabled, textareaRef, value, lang, render]);

  const toggle = useCallback(() => {
    if (recognizerRef.current) stop();
    else start();
  }, [start, stop]);

  const onManualEdit = useCallback(() => {
    if (!recognizerRef.current) return;
    detachedRef.current = true;
    stop();
  }, [stop]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!recognizerRef.current) return;
      event.preventDefault();
      stop();
    },
    [stop],
  );

  // Disabled while a session runs (config hot-swap), or unmount: abort hard.
  useEffect(() => {
    if (enabled) return;
    recognizerRef.current?.abort();
  }, [enabled]);
  useEffect(
    () => () => {
      detachedRef.current = true; // never setValue on an unmounted composer
      recognizerRef.current?.abort();
      recognizerRef.current = null;
    },
    [],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return { supported, state, notice, clearNotice, start, stop, toggle, onManualEdit, onKeyDown };
}

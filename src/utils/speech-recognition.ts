/**
 * Browser speech recognition primitives for composer dictation.
 *
 * Everything the dictation hook needs that is NOT React: feature detection,
 * a minimal ambient type shim (TypeScript's `lib.dom` does not ship
 * `SpeechRecognition` types), the error-code → state mapper, and the pure
 * text-joining helpers. Zero dependencies. Nothing here touches the network
 * or the server — the browser's recognizer produces text, and that text
 * enters the widget exactly like typed input.
 */

// ── Ambient shim (only the members we use) ─────────────────────────────────

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  /** W3C error code: 'not-allowed' | 'no-speech' | 'network' | 'audio-capture' | 'aborted' | … */
  error: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: unknown) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Returns the browser's recognizer constructor, or `null` when the API is
 * absent (SSR, Firefox with the pref off, older WebViews). Callers render
 * nothing in the `null` case — the unsupported browser must look exactly
 * like it did before dictation existed.
 */
export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Errors ─────────────────────────────────────────────────────────────────

export type DictationErrorKind = 'denied' | 'no-speech' | 'network' | 'no-mic' | 'aborted' | 'unknown';

/** Maps a W3C `SpeechRecognitionErrorEvent.error` code to what the UI does about it. */
export function classifyDictationError(code: string | undefined): DictationErrorKind {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'audio-capture':
      return 'no-mic';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/**
 * User-facing inline notice for a transient failure, or `null` when the
 * failure needs no message (a silence timeout, our own abort, or a permission
 * denial — which the button itself reports through its blocked state).
 */
export function dictationNotice(kind: DictationErrorKind): string | null {
  switch (kind) {
    case 'network':
      return 'Dictation needs an internet connection.';
    case 'no-mic':
      return 'No microphone was found.';
    case 'unknown':
      return 'Dictation stopped unexpectedly. Try again.';
    default:
      return null;
  }
}

// ── Text assembly ──────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?]\s*$/;
const LEADING_PUNCTUATION = /^[,.;:!?)\]}%]/;

/**
 * Formats a recognized segment so it reads naturally after `before`:
 * a single joining space when `before` doesn't already end in whitespace (and
 * the segment doesn't start with closing punctuation), and a capital letter
 * when the segment opens a sentence. Browsers return raw, mostly lowercase,
 * mostly unpunctuated text; this is the minimum that makes the result look
 * typed. Returns '' for an empty segment.
 */
export function joinDictation(before: string, segment: string): string {
  const text = segment.trim();
  if (!text) return '';
  const startsSentence = before.trim() === '' || SENTENCE_END.test(before);
  const cased = startsSentence ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  const needsSpace = before.length > 0 && !/\s$/.test(before) && !LEADING_PUNCTUATION.test(cased);
  return (needsSpace ? ' ' : '') + cased;
}

export interface DictationComposition {
  /** The full textarea value. */
  value: string;
  /** Caret position — the end of the dictated span. */
  caret: number;
}

/**
 * Builds the textarea value while dictating: the text before the caret at
 * start, the committed (final) segments, the live interim tail, then the
 * text that was after the selection. Pure, so the hook's `onresult` handler
 * is a one-liner and the join rules are unit-testable.
 */
export function composeDictation(
  before: string,
  committed: string,
  interim: string,
  after: string,
): DictationComposition {
  const head = before + committed + joinDictation(before + committed, interim);
  const caret = head.length;
  // Keep a space between the dictated span and any trailing text.
  const gap = after && head.length > before.length && !/^\s/.test(after) && !/\s$/.test(head) ? ' ' : '';
  return { value: head + gap + after, caret };
}

/**
 * Folds a batch of recognizer results into `{ committed, interim }`. The
 * results list is cumulative for the session (`continuous: true`), so we
 * rebuild from index 0 each time — idempotent, and immune to the
 * `resultIndex` quirks across engines.
 */
export function foldDictationResults(
  before: string,
  results: SpeechRecognitionResultListLike,
): { committed: string; interim: string } {
  let committed = '';
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const transcript = result?.[0]?.transcript ?? '';
    if (!transcript) continue;
    if (result.isFinal) committed += joinDictation(before + committed, transcript);
    else interim.push(transcript.trim());
  }
  return { committed, interim: interim.filter(Boolean).join(' ') };
}

/**
 * Recognition language: an explicit BCP-47 override wins, then the page's
 * `<html lang>`, then the browser language. `undefined` lets the recognizer
 * pick its own default.
 */
export function resolveDictationLanguage(override?: string): string | undefined {
  const explicit = override?.trim();
  if (explicit) return explicit;
  if (typeof document !== 'undefined') {
    const pageLang = document.documentElement?.lang?.trim();
    if (pageLang) return pageLang;
  }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return undefined;
}

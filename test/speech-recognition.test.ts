import { describe, expect, it } from 'vitest';

import {
  classifyDictationError,
  composeDictation,
  dictationNotice,
  foldDictationResults,
  getSpeechRecognition,
  joinDictation,
  resolveDictationLanguage,
} from '../src/utils/speech-recognition';

describe('joinDictation', () => {
  it('capitalizes the first segment of an empty composer', () => {
    expect(joinDictation('', 'hello there')).toBe('Hello there');
    expect(joinDictation('   ', 'hello')).toBe('Hello');
  });

  it('adds one joining space after text that lacks one', () => {
    expect(joinDictation('Hello', 'world')).toBe(' world');
    expect(joinDictation('Hello ', 'world')).toBe('world');
    expect(joinDictation('Hello\n', 'world')).toBe('world');
  });

  it('starts a new sentence after terminal punctuation', () => {
    expect(joinDictation('Done.', 'next one')).toBe(' Next one');
    expect(joinDictation('Really?', 'yes')).toBe(' Yes');
    expect(joinDictation('Really? ', 'yes')).toBe('Yes');
  });

  it('never inserts a space before closing punctuation and drops empty segments', () => {
    expect(joinDictation('Hello', ', world')).toBe(', world');
    expect(joinDictation('Hello', '')).toBe('');
    expect(joinDictation('Hello', '   ')).toBe('');
  });
});

describe('composeDictation', () => {
  it('inserts committed + interim between the snapshot halves with the caret at the span end', () => {
    const c = composeDictation('Ship it', ' tomorrow', 'morning', ' please');
    expect(c.value).toBe('Ship it tomorrow morning please');
    expect(c.caret).toBe('Ship it tomorrow morning'.length);
  });

  it('keeps a space between the dictated span and trailing text', () => {
    expect(composeDictation('', 'Hello', '', 'world').value).toBe('Hello world');
    expect(composeDictation('', '', '', 'world').value).toBe('world');
  });
});

describe('foldDictationResults', () => {
  const list = (items: Array<[string, boolean]>) => {
    const results = items.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript, confidence: 0.9 } }));
    return { length: results.length, ...results } as unknown as Parameters<typeof foldDictationResults>[1];
  };

  it('rebuilds committed and interim from the cumulative result list', () => {
    expect(foldDictationResults('', list([['hello', true], ['how are', false]]))).toEqual({
      committed: 'Hello',
      interim: 'how are',
    });
    expect(foldDictationResults('Note:', list([['first point.', true], ['second point', true]]))).toEqual({
      committed: ' first point. Second point',
      interim: '',
    });
  });

  it('is idempotent across repeated events (no duplicated words)', () => {
    const results = list([['hello', true], ['world', true]]);
    const once = foldDictationResults('', results);
    expect(foldDictationResults('', results)).toEqual(once);
    expect(once.committed).toBe('Hello world');
  });
});

describe('error mapping', () => {
  it('maps W3C codes to UI states', () => {
    expect(classifyDictationError('not-allowed')).toBe('denied');
    expect(classifyDictationError('service-not-allowed')).toBe('denied');
    expect(classifyDictationError('no-speech')).toBe('no-speech');
    expect(classifyDictationError('network')).toBe('network');
    expect(classifyDictationError('audio-capture')).toBe('no-mic');
    expect(classifyDictationError('aborted')).toBe('aborted');
    expect(classifyDictationError('something-new')).toBe('unknown');
    expect(classifyDictationError(undefined)).toBe('unknown');
  });

  it('only surfaces a notice for failures the user can act on', () => {
    expect(dictationNotice('network')).toMatch(/internet/);
    expect(dictationNotice('no-mic')).toMatch(/microphone/i);
    expect(dictationNotice('unknown')).toBeTruthy();
    expect(dictationNotice('denied')).toBeNull();
    expect(dictationNotice('no-speech')).toBeNull();
    expect(dictationNotice('aborted')).toBeNull();
  });
});

describe('environment helpers (node)', () => {
  it('reports no recognizer without a DOM and prefers an explicit language', () => {
    expect(getSpeechRecognition()).toBeNull();
    // Node ≥ 21 ships a global `navigator` (language 'en-US'); older runtimes
    // have none. Either way there is no document to read `<html lang>` from.
    const fallback = resolveDictationLanguage(undefined);
    expect(fallback === undefined || typeof fallback === 'string').toBe(true);
    expect(resolveDictationLanguage(' fr-CA ')).toBe('fr-CA');
  });
});

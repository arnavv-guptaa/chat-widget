import { describe, expect, it } from 'vitest';
import { resolveCitationSource, type CitationSource } from '../src/components/citation-markers';
import { toSourceParts } from '../src/server/knowledge/retrieval';
import type { RetrievedChunk } from '../src/server/knowledge/types';

function chunk(id: string, url: string, title: string): RetrievedChunk {
  return { id, text: `text:${id}`, score: 1, source: { url, title } };
}

describe('citation source identity', () => {
  it('preserves every original DOC id when duplicate URLs collapse', () => {
    const parts = toSourceParts([
      chunk('a-1', 'https://example.com/a', 'A'),
      chunk('a-2', 'https://example.com/a', 'A duplicate'),
      chunk('b-1', 'https://example.com/b', 'B'),
    ]);

    expect(parts).toHaveLength(2);
    expect(parts[0].citationIds).toEqual([1, 2]);
    expect(parts[1].citationIds).toEqual([3]);
    expect(resolveCitationSource(parts, 2)?.url).toBe('https://example.com/a');
    expect(resolveCitationSource(parts, 3)?.url).toBe('https://example.com/b');
    expect(resolveCitationSource(parts, 4)).toBeUndefined();
  });

  it('falls back to list position only when no explicit ids exist', () => {
    const providerSources: CitationSource[] = [
      { type: 'source-url', url: 'https://example.com/one' },
      { type: 'source-url', url: 'https://example.com/two' },
    ];

    expect(resolveCitationSource(providerSources, 2)?.url).toBe('https://example.com/two');
  });

  it('honors a provider numeric sourceId before positional fallback', () => {
    const providerSources: CitationSource[] = [
      { type: 'source-url', sourceId: '7', url: 'https://example.com/seven' },
      { type: 'source-url', sourceId: '2', url: 'https://example.com/two' },
    ];

    expect(resolveCitationSource(providerSources, 7)?.url).toBe('https://example.com/seven');
  });
});

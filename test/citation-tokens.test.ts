import { describe, it, expect } from 'vitest';
import {
  parseRefs,
  splitCitations,
  remarkCitations,
} from '../src/utils/citation-tokens';

// The inline-citation parser (#138): the model emits `[ref: N]` / `[N]` tokens
// in assistant prose and the renderer must turn them into linked superscript
// chips, NOT leave them as the literal "[ref: 4, ref: 6]" text. These tests pin
// the token contract — including the negative cases (years, versions, prose
// brackets) that must NOT be mistaken for citations — and the remark plugin's
// mdast transform, especially that code-fence text is never split.

describe('parseRefs — bracket inner content', () => {
  it('parses explicit ref: form (single + comma list)', () => {
    expect(parseRefs('ref: 4')).toEqual([{ n: 4, raw: '4' }]);
    expect(parseRefs('ref: 2, ref: 4, ref: 6')).toEqual([
      { n: 2, raw: '2' },
      { n: 4, raw: '4' },
      { n: 6, raw: '6' },
    ]);
  });

  it('parses bare numeric form (single + comma list)', () => {
    expect(parseRefs('1')).toEqual([{ n: 1, raw: '1' }]);
    expect(parseRefs('2, 4, 6')).toEqual([
      { n: 2, raw: '2' },
      { n: 4, raw: '4' },
      { n: 6, raw: '6' },
    ]);
  });

  it('parses mixed ref:/bare in one list', () => {
    expect(parseRefs('ref: 2, 4')).toEqual([
      { n: 2, raw: '2' },
      { n: 4, raw: '4' },
    ]);
  });

  it('rejects non-citation brackets (years, versions, words)', () => {
    expect(parseRefs('2024')).toBeNull(); // 4-digit year — too large to be a ref index
    expect(parseRefs('v2')).toBeNull(); // not numeric
    expect(parseRefs('ref: foo')).toBeNull(); // non-numeric ref
    expect(parseRefs('see also')).toBeNull(); // prose
    expect(parseRefs('')).toBeNull();
  });

  it('is case-insensitive on the ref: prefix', () => {
    expect(parseRefs('REF: 4')).toEqual([{ n: 4, raw: '4' }]);
    expect(parseRefs('Ref: 4')).toEqual([{ n: 4, raw: '4' }]);
  });
});

describe('splitCitations — text segmentation', () => {
  it('extracts the screenshot tokens in order', () => {
    // Verbatim from the bug report screenshot.
    const out = splitCitations('scoped to the bound user [ref: 4, ref: 6].');
    expect(out).toEqual([
      { kind: 'text', text: 'scoped to the bound user ' },
      { kind: 'refs', refs: [{ n: 4, raw: '4' }, { n: 6, raw: '6' }], raw: '[ref: 4, ref: 6]' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('handles multiple refs in one sentence', () => {
    const out = splitCitations('ensureConversation [ref: 2] then 403 [ref: 2, ref: 4, ref: 6].');
    expect(out).toEqual([
      { kind: 'text', text: 'ensureConversation ' },
      { kind: 'refs', refs: [{ n: 2, raw: '2' }], raw: '[ref: 2]' },
      { kind: 'text', text: ' then 403 ' },
      {
        kind: 'refs',
        refs: [
          { n: 2, raw: '2' },
          { n: 4, raw: '4' },
          { n: 6, raw: '6' },
        ],
        raw: '[ref: 2, ref: 4, ref: 6]',
      },
      { kind: 'text', text: '.' },
    ]);
  });

  it('parses bare [N] from the auto-retrieve prompt', () => {
    const out = splitCitations('cite e.g. [1].');
    expect(out).toEqual([
      { kind: 'text', text: 'cite e.g. ' },
      { kind: 'refs', refs: [{ n: 1, raw: '1' }], raw: '[1]' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('returns a single text segment when there are no citations', () => {
    expect(splitCitations('no refs here at all')).toEqual([
      { kind: 'text', text: 'no refs here at all' },
    ]);
  });

  it('does NOT treat years / versions / prose brackets as citations', () => {
    // [2024] and [v2] must survive as literal text — they are not citations.
    expect(splitCitations('built in [2024], version [v2]')).toEqual([
      { kind: 'text', text: 'built in [2024], version [v2]' },
    ]);
  });

  it('handles empty / whitespace-only input', () => {
    expect(splitCitations('')).toEqual([]);
  });
});

describe('remarkCitations — mdast transform', () => {
  // Minimal mdast builder helpers — the plugin only inspects `type`, `value`,
  // and `children`, so we don't need the full @types/mdast shape.
  function text(value: string) {
    return { type: 'text', value };
  }
  function paragraph(...children: any[]) {
    return { type: 'paragraph', children };
  }
  function code(value: string, lang = 'ts') {
    return { type: 'code', lang, value };
  }
  function root(...children: any[]) {
    return { type: 'root', children };
  }

  function run(tree: any) {
    const plugin = remarkCitations();
    return plugin(tree);
  }

  it('replaces a citation token in a paragraph with a citeRef element', () => {
    const tree = root(paragraph(text('see [ref: 3] for details')));
    run(tree);
    const kids = (tree.children[0] as any).children;
    expect(kids).toHaveLength(3);
    // The render transform glues the chip to the preceding word so it cannot
    // wrap onto a line by itself; splitCitations itself remains unchanged.
    expect(kids[0]).toEqual({ type: 'text', value: 'see\u00a0' });
    expect(kids[1].type).toBe('citeRef');
    expect(kids[1].data?.hName).toBe('citeRef');
    expect(kids[1].data?.hProperties?.['data-ref-n']).toBe('3');
    expect(kids[2]).toEqual({ type: 'text', value: ' for details' });
  });

  it('emits one citeRef per ref in a [ref: N, ref: M] list', () => {
    const tree = root(paragraph(text('x [ref: 2, ref: 4] y')));
    run(tree);
    const kids = (tree.children[0] as any).children;
    // text("x "), citeRef(2), citeRef(4), text(" y")
    expect(kids.map((k: any) => k.type)).toEqual(['text', 'citeRef', 'citeRef', 'text']);
    expect(kids[1].data?.hProperties?.['data-ref-n']).toBe('2');
    expect(kids[2].data?.hProperties?.['data-ref-n']).toBe('4');
  });

  it('does NOT split text inside code fences (refs in code stay literal)', () => {
    // The critical safety property: a code fence's text lives in `value`, not in
    // `text` children, so the text-walker never enters it. A snippet that
    // happens to contain `[ref: 1]` must stay literal code, not become a chip.
    const src = 'const x = "[ref: 1]";\n// see [ref: 2]';
    const tree = root(code(src, 'ts'));
    run(tree);
    expect((tree.children[0] as any).value).toBe(src);
    expect((tree.children[0] as any).type).toBe('code');
  });

  it('does NOT split text inside inline code', () => {
    // Inline code is an `inlineCode` node with a `value`, also childless — so a
    // ref inside backticks stays literal.
    const tree = root(paragraph({ type: 'inlineCode', value: 'arr[ref: 1]' }, text(' ok')));
    run(tree);
    const kids = (tree.children[0] as any).children;
    expect(kids[0]).toEqual({ type: 'inlineCode', value: 'arr[ref: 1]' });
    expect(kids[1]).toEqual({ type: 'text', value: ' ok' });
  });

  it('is a no-op on prose with no citations (fast path leaves the tree alone)', () => {
    const before = root(paragraph(text('just plain prose, no brackets')));
    const snapshot = JSON.stringify(before);
    run(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('handles citations nested inside bold/strong text', () => {
    const tree = root(
      paragraph({ type: 'strong', children: [text('see [ref: 5]')] }),
    );
    run(tree);
    const strong = (tree.children[0] as any).children[0];
    expect(strong.type).toBe('strong');
    // No trailing text node: the citation ends the string, and splitCitations
    // only emits trailing text when there is some (`last < text.length`).
    expect(strong.children.map((c: any) => c.type)).toEqual(['text', 'citeRef']);
    expect(strong.children[1].data?.hProperties?.['data-ref-n']).toBe('5');
  });
});

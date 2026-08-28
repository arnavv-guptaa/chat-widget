import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.src.css', import.meta.url), 'utf8');
/* Declarations only — rationale comments quote the values they replaced, so a
   naive substring check on the raw file matches the prose, not the CSS. */
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');
const widget = readFileSync(new URL('../src/ChatWidget.tsx', import.meta.url), 'utf8');
const sources = readFileSync(new URL('../src/components/sources.tsx', import.meta.url), 'utf8');
const response = readFileSync(new URL('../src/components/response.tsx', import.meta.url), 'utf8');
const tool = readFileSync(new URL('../src/components/tool.tsx', import.meta.url), 'utf8');
const actionPrimitives = readFileSync(new URL('../src/components/action-primitives.tsx', import.meta.url), 'utf8');
const agentToolCall = readFileSync(new URL('../src/components/transcript/AgentToolCall.tsx', import.meta.url), 'utf8');
const interfaceTs = readFileSync(new URL('../src/components/interface.tsx', import.meta.url), 'utf8');

describe('renderer design-system contract', () => {
  it('defines the semantic renderer ramp in defaults and themed mode', () => {
    for (const token of [
      '--chat-primary-tint',
      '--chat-hairline',
      '--chat-border-soft',
      '--chat-text-body',
      '--chat-text-faint',
    ]) {
      expect(css).toContain(token);
      expect(widget).toContain(`styles['${token}']`);
    }
  });

  it('keeps fenced code open with a bounded ten-line-scale body', () => {
    const rule = css.match(/\.chat-widget-container \.chat-code-body\s*\{([\s\S]*?)\}/);
    expect(rule?.[1]).toContain('max-height: 14rem');
    expect(rule?.[1]).toContain('font-size: 12.5px');
    expect(rule?.[1]).toContain('line-height: 1.55');
  });

  it('uses the brand tint for linked citation chips', () => {
    const rule = css.match(/\.chat-widget-container a\.chat-cite-ref-link\s*\{([\s\S]*?)\}/);
    expect(rule?.[1]).toContain('color: hsl(var(--chat-primary))');
    expect(rule?.[1]).toContain('background-color: hsl(var(--chat-primary-tint))');
  });

  it('renders source favicons with a graceful fallback', () => {
    // The favicon is fetched as a plain <img> from Google's S2 endpoint; the
    // host is already shown in the row, so this leaks nothing new. A non-web
    // source or a failed load falls back to the file glyph — never a broken img.
    expect(sources).toContain('/favicon.ico');
    expect(sources).toContain('google.com/s2/favicons');
    expect(sources).toContain('setCandidate((i) => i + 1)');
    expect(sources).toContain('FileTextIcon');
    expect(sources).toContain('safeUrl(href)');
    expect(sources).not.toContain('ExternalLinkIcon');
  });

  it('parses citation tokens only for explicitly sourced assistant responses', () => {
    expect(response).toContain('sources !== undefined');
    expect(response).toContain('? [remarkCitations, ...baseRemarkPlugins]');
    expect(response).not.toContain('(prevProps, nextProps)');
  });

  it('pairs visual status glyphs with assistive text', () => {
    expect(tool).toContain('<span className="sr-only">{STATUS_LABELS[state]}: </span>');
    expect(actionPrimitives).toContain('<span className="sr-only">{statusLabel}: </span>');
    expect(agentToolCall).toContain('<span className="sr-only">{accessibleStatus}: </span>');
  });

  it('shows an optional greeting-led empty state', () => {
    // Greeting + subGreeting are opt-in; when set they render a strong
    // headline plus a faint sub line above the starter prompts.
    // (assistantName is identity, deliberately not part of this block.)
    expect(interfaceTs).toContain('config?.greeting');
    expect(interfaceTs).toContain('config?.subGreeting');
    expect(interfaceTs).toContain('letterSpacing: \'-0.01em\'');
  });

  it('sizes tables to their content instead of crushing them into the bubble', () => {
    // Regression: `width: 100%` squeezed every column into the ~380px widget,
    // and cells inherited `overflow-wrap: anywhere` from .chat-message-content.
    // `anywhere` makes each CHARACTER a wrap opportunity for min-content width,
    // so the auto table layout crushed columns to one character per line.
    const table = decls.match(
      /\.chat-table table\s*\{([\s\S]*?)\}/,
    );
    expect(table?.[1]).toContain('width: max-content');
    expect(table?.[1]).toContain('min-width: 100%');
    // ...and no bare `width: 100%` (the `min-width` above legitimately ends
    // in the same substring, so match the property, not the text).
    expect(table?.[1]).not.toMatch(/(?<!min-)width:\s*100%/);

    const cells = decls.match(/\.chat-table :is\(th, td\)\s*\{([\s\S]*?)\}/);
    expect(cells?.[1]).toContain('overflow-wrap: break-word');
    expect(cells?.[1]).toContain('word-break: normal');
    expect(cells?.[1]).not.toContain('anywhere');

    // The runaway-column cap belongs on td only — th is nowrap, so a cap there
    // would spill a long header out of its cell rather than widen the column.
    const td = decls.match(/\.chat-table td\s*\{([\s\S]*?)\}/);
    expect(td?.[1]).toContain('max-width: 20rem');
    const th = decls.match(/\.chat-table th\s*\{([\s\S]*?)\}/);
    expect(th?.[1]).toContain('white-space: nowrap');
    expect(th?.[1]).not.toContain('max-width');
  });

  it('makes a wide table read as scrollable, by fade and by keyboard', () => {
    // Horizontal scroll inside a chat bubble is invisible without a cue, and a
    // mouse-only scroller strands the hidden columns for keyboard users.
    expect(css).toContain('.chat-table[data-overflow="start"]::before');
    expect(css).toContain('.chat-table[data-overflow="both"]::before');
    expect(css).toContain('.chat-table[data-overflow="end"]::after');
    expect(css).toContain('.chat-table-scroll:focus-visible');

    const markdownTable = readFileSync(
      new URL('../src/components/markdown-table.tsx', import.meta.url),
      'utf8',
    );
    expect(markdownTable).toContain('data-overflow={overflow}');
    expect(markdownTable).toContain('new ResizeObserver(sync)');
    // Rows stream in one at a time — observing only the scroller would freeze
    // the fade at its first (empty) measurement.
    expect(markdownTable).toContain('observer.observe(tableRef.current)');
    expect(markdownTable).toContain('role: "region"');
  });

  it('reveals the table copy button on hover without stranding touch or keyboard', () => {
    // Parked permanently over the header it covered a column label. Hiding it
    // is only safe where hover exists, and it must survive focus + the ✓ state.
    const hoverBlock = css.match(/@media \(hover: hover\) \{([\s\S]*?)\n\}/);
    expect(hoverBlock?.[1]).toContain('.chat-table-copy {\n    opacity: 0;');
    expect(hoverBlock?.[1]).toContain('.chat-table:hover .chat-table-copy');
    expect(hoverBlock?.[1]).toContain('.chat-table-copy:focus-visible');
    expect(hoverBlock?.[1]).toContain('.chat-table-copy[data-copied]');

    const markdownTable = readFileSync(
      new URL('../src/components/markdown-table.tsx', import.meta.url),
      'utf8',
    );
    expect(markdownTable).toContain('data-copied={copied ? "" : undefined}');
  });

  it('keeps the composer focus treatment subtle and token-driven', () => {
    const rule = css.match(/\.chat-widget-container \.chat-prompt-box:focus-within\s*\{([\s\S]*?)\}/);
    expect(rule?.[1]).toContain('hsl(var(--chat-primary) / 0.07)');
  });
});

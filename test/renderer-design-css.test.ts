import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.src.css', import.meta.url), 'utf8');
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
    expect(sources).toContain('google.com/s2/favicons');
    expect(sources).toContain('onError={() => setFailed(true)}');
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
    // Greeting + assistantName are opt-in; when set they render a strong
    // headline plus a faint sub line above the starter prompts.
    expect(interfaceTs).toContain('config?.greeting');
    expect(interfaceTs).toContain('config?.assistantName');
    expect(interfaceTs).toContain('letterSpacing: \'-0.01em\'');
  });

  it('keeps the composer focus treatment subtle and token-driven', () => {
    const rule = css.match(/\.chat-widget-container \.chat-prompt-box:focus-within\s*\{([\s\S]*?)\}/);
    expect(rule?.[1]).toContain('hsl(var(--chat-primary) / 0.07)');
  });
});

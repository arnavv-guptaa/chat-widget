import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.src.css', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/ChatWidget.tsx', import.meta.url), 'utf8');
const sources = readFileSync(new URL('../src/components/sources.tsx', import.meta.url), 'utf8');
const response = readFileSync(new URL('../src/components/response.tsx', import.meta.url), 'utf8');

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

  it('does not leak source hosts to a third-party favicon service', () => {
    expect(sources).not.toContain('google.com/s2/favicons');
    expect(sources).not.toContain('ExternalLinkIcon');
    expect(sources).toContain('safeUrl(href)');
  });

  it('parses citation tokens only for explicitly sourced assistant responses', () => {
    expect(response).toContain('sources !== undefined');
    expect(response).toContain('? [remarkCitations, ...baseRemarkPlugins]');
    expect(response).not.toContain('(prevProps, nextProps)');
  });

  it('keeps the composer focus treatment subtle and token-driven', () => {
    const rule = css.match(/\.chat-widget-container \.chat-prompt-box:focus-within\s*\{([\s\S]*?)\}/);
    expect(rule?.[1]).toContain('hsl(var(--chat-primary) / 0.07)');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.src.css', import.meta.url), 'utf8');

describe('text shimmer CSS contract', () => {
  it('keeps transparent clipped text inside assistant message content', () => {
    const rule = css.match(
      /\.chat-widget-container \.chat-text-shimmer,\s*\.chat-widget-container \.is-assistant \.chat-message-content \.chat-text-shimmer\s*\{([\s\S]*?)\}/,
    );

    expect(rule?.[1]).toContain('color: transparent');
    expect(rule?.[1]).toContain('background-clip: text');
    expect(rule?.[1]).toContain('animation: chat-text-shimmer 1.4s linear infinite');
  });
});

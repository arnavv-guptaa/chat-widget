/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MermaidCode, ResponseStreamingContext } from '../src/components/mermaid-block';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async () => true),
  render: vi.fn(async () => ({ svg: '<svg aria-label="Rendered diagram"></svg>' })),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

describe('Mermaid streaming stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('holds one stable placeholder and renders only after streaming settles', async () => {
    const { getByRole, findByRole, rerender } = render(
      <ResponseStreamingContext.Provider value>
        <MermaidCode className="language-mermaid">{'graph TD\n  A--'}</MermaidCode>
      </ResponseStreamingContext.Provider>,
    );

    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();

    // Token updates must not repeatedly parse, measure, clear, and replace SVGs.
    rerender(
      <ResponseStreamingContext.Provider value>
        <MermaidCode className="language-mermaid">{'graph TD\n  A-->B\n  B-->C'}</MermaidCode>
      </ResponseStreamingContext.Provider>,
    );
    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();

    rerender(
      <ResponseStreamingContext.Provider value={false}>
        <MermaidCode className="language-mermaid">{'graph TD\n  A-->B\n  B-->C'}</MermaidCode>
      </ResponseStreamingContext.Provider>,
    );

    // Ending the stream starts the one real render without collapsing the card.
    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    expect(await findByRole('figure', { name: 'Diagram' })).toBeTruthy();
    expect(mermaid.parse).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });
});

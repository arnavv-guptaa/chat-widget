/**
 * @vitest-environment jsdom
 *
 * Mermaid must never leave anything on the HOST page.
 *
 * mermaid renders by measuring real layout, so it needs a live element. Left to
 * itself it creates one on `document.body` — outside `.chat-widget-container`,
 * i.e. in the page the widget is embedded in. On a syntax error it paints its
 * "bomb" error graphic into that node, throws, and leaves it attached: the
 * widget falls back to showing the code (correct) while the customer's site is
 * left with a full-width error graphic below the fold (shipped to production).
 *
 * Model output is untrusted input to a parser, so an invalid diagram is the
 * expected case. These tests pin the containment rather than the fallback UI:
 * whatever mermaid does internally, body must be exactly as clean afterwards as
 * it was before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MermaidCode } from '../src/components/mermaid-block';

/** Everything under body that isn't the testing-library render root. */
function strayNodes(roots: Element[]): Element[] {
  return Array.from(document.body.children).filter((el) => !roots.includes(el));
}

describe('mermaid containment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    cleanup();
  });

  it('leaves nothing on document.body after an INVALID diagram', async () => {
    const { container, getByText } = render(
      <MermaidCode className="language-mermaid">{'graph TD\n  A --> ((( broken'}</MermaidCode>,
    );

    // The fallback proves the render attempt actually resolved (rather than the
    // assertion passing because nothing ran yet).
    await waitFor(() => expect(getByText(/broken/)).toBeTruthy());

    expect(strayNodes([container])).toHaveLength(0);
    // The specific artefact from the production report.
    expect(document.body.textContent).not.toContain('Syntax error in text');
  });

  it('leaves nothing on document.body after a VALID diagram', async () => {
    const { container, queryByRole } = render(
      <MermaidCode className="language-mermaid">{'graph TD\n  A-->B'}</MermaidCode>,
    );

    // jsdom cannot lay out SVG, so mermaid may still fail here — that is fine.
    // Wait for the pending state to leave, not just text: the labelled placeholder
    // now has text before Mermaid has parsed or rendered anything.
    await waitFor(() => expect(queryByRole('status')).toBeNull());
    expect(strayNodes([container])).toHaveLength(0);
  });

  it('leaves nothing behind when unmounted mid-render', async () => {
    const { container, unmount } = render(
      <MermaidCode className="language-mermaid">{'graph TD\n  A-->B'}</MermaidCode>,
    );
    // Unmount immediately: the scratch container must not outlive the effect
    // that created it, even when the render never settles.
    unmount();

    await waitFor(() => expect(strayNodes([container])).toHaveLength(0));
  });
});

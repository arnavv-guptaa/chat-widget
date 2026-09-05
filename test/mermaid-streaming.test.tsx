/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Response } from '../src/components/response';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MermaidCode, ResponseStreamingContext } from '../src/components/mermaid-block';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async () => true),
  render: vi.fn(async () => ({ svg: '<svg aria-label="Rendered diagram"></svg>' })),
}));

vi.mock('mermaid', () => ({ default: mermaid }));
// Keep the actual, accessible code fallback without starting Shiki imports.
vi.mock('../src/utils/highlight', () => ({ highlightCode: vi.fn(async () => null) }));
// Isolate the markdown/context boundary from the unrelated RAF reveal timer.
vi.mock('../src/hooks/use-smooth-text', () => ({ useSmoothText: (text: string) => text }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function streamingCode(code: string, isStreaming: boolean) {
  return (
    <ResponseStreamingContext.Provider value={isStreaming}>
      <MermaidCode className="language-mermaid">{code}</MermaidCode>
    </ResponseStreamingContext.Provider>
  );
}

describe('Mermaid streaming stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mermaid.parse.mockReset().mockResolvedValue(true);
    mermaid.render.mockReset().mockResolvedValue({ svg: '<svg aria-label="Rendered diagram"></svg>' });
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

    const placeholder = getByRole('status', { name: 'Generating diagram' });
    // Let the preload finish: absence of parser/layout work must hold after
    // import, not just synchronously before the promise gets a chance to run.
    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      suppressErrorRendering: true,
      startOnLoad: false,
    })));
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();

    // Token updates must not repeatedly parse, measure, clear, and replace SVGs.
    rerender(
      <ResponseStreamingContext.Provider value>
        <MermaidCode className="language-mermaid">{'graph TD\n  A-->B\n  B-->C'}</MermaidCode>
      </ResponseStreamingContext.Provider>,
    );
    await act(async () => {});
    expect(getByRole('status', { name: 'Generating diagram' })).toBe(placeholder);
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
    expect(mermaid.parse).toHaveBeenCalledWith('graph TD\n  A-->B\n  B-->C', { suppressErrors: true });
  });

  it('propagates a status-only settle through a memoized renderer', async () => {
    // Streamdown can skip a render when fenced text is unchanged. Context must
    // still reach its Mermaid descendant without changing component identity.
    const MemoizedFence = memo(() => <MermaidCode className="language-mermaid">{'graph TD\n  A-->B'}</MermaidCode>);
    const { rerender, findByRole } = render(
      <ResponseStreamingContext.Provider value><MemoizedFence /></ResponseStreamingContext.Provider>,
    );
    await act(async () => {});
    expect(mermaid.parse).not.toHaveBeenCalled();
    rerender(
      <ResponseStreamingContext.Provider value={false}><MemoizedFence /></ResponseStreamingContext.Provider>,
    );
    expect(await findByRole('figure', { name: 'Diagram' })).toBeTruthy();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it.each(['false', 'throw'])('falls back accessibly after invalid settled source (%s)', async (mode) => {
    if (mode === 'false') mermaid.parse.mockResolvedValueOnce(false);
    else mermaid.parse.mockRejectedValueOnce(new Error('Invalid diagram'));
    const code = 'graph TD\n  A --> ((( broken';
    const { rerender, findByRole, queryByRole, container } = render(streamingCode(code, true));
    await act(async () => {});
    expect(mermaid.parse).not.toHaveBeenCalled();
    rerender(streamingCode(code, false));
    expect(await findByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toBe(code);
    expect(queryByRole('status')).toBeNull();
    expect(queryByRole('figure')).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('falls back for an empty settled fence without parsing or rendering', async () => {
    const { rerender, findByRole, queryByRole } = render(streamingCode('', true));
    rerender(streamingCode('', false));
    expect(await findByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(queryByRole('status')).toBeNull();
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('removes its scratch container on render failure and preserves raw source', async () => {
    const result = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(result.promise);
    const code = 'graph TD\n  A-->B';
    const { container, findByRole } = render(streamingCode(code, false));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const scratch = document.body.querySelector('.chat-widget-container');
    expect(scratch?.getAttribute('aria-hidden')).toBe('true');
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^mordn-mermaid-/), code, scratch);
    await act(async () => { result.reject(new Error('Layout failed')); });
    expect(await findByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toBe(code);
    expect(scratch?.isConnected).toBe(false);
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('does not start parsing when unmounted before the loader continuation', async () => {
    const { unmount, container } = render(streamingCode('graph TD\n  A-->B', false));
    unmount();
    await act(async () => {});
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('does not start rendering if unmounted while parsing', async () => {
    const parsed = deferred<boolean>();
    mermaid.parse.mockReturnValueOnce(parsed.promise);
    const { unmount, container } = render(streamingCode('graph TD\n  A-->B', false));
    await waitFor(() => expect(mermaid.parse).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { parsed.resolve(true); });
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('cleans up immediately on unmount during rendering and ignores late SVG', async () => {
    const result = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(result.promise);
    const { unmount, container } = render(streamingCode('graph TD\n  A-->B', false));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const scratch = document.body.querySelector('.chat-widget-container');
    expect(scratch).not.toBeNull();
    unmount();
    expect(scratch?.isConnected).toBe(false);
    await act(async () => { result.resolve({ svg: '<svg aria-label="Late diagram"></svg>' }); });
    expect(container.innerHTML).toBe('');
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('ignores an older render after streaming resumes and a newer response settles', async () => {
    const oldResult = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(oldResult.promise);
    const { rerender, getByRole, findByRole, container } = render(streamingCode('graph TD\n  A-->B', false));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const scratch = document.body.querySelector('.chat-widget-container');
    rerender(streamingCode('graph TD\n  A-->B\n  B--', true));
    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    expect(scratch?.isConnected).toBe(false);
    await act(async () => {});
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    rerender(streamingCode('graph TD\n  A-->B\n  B-->C', false));
    const figure = await findByRole('figure', { name: 'Diagram' });
    await act(async () => { oldResult.resolve({ svg: '<svg aria-label="Stale diagram"></svg>' }); });
    expect(figure.querySelector('[aria-label="Rendered diagram"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Stale diagram"]')).toBeNull();
    expect(mermaid.parse).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it('settles and resumes through the real Response and Streamdown boundary', async () => {
    const text = '```mermaid\ngraph TD\n  A-->B\n```';
    const { rerender, getByRole, findByRole, container } = render(<Response isStreaming>{text}</Response>);
    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    await act(async () => {});
    expect(mermaid.render).not.toHaveBeenCalled();
    // Identical markdown: only status changed, not Streamdown's text input.
    rerender(<Response isStreaming={false}>{text}</Response>);
    expect(await findByRole('figure', { name: 'Diagram' })).toBeTruthy();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    rerender(<Response isStreaming>{text}</Response>);
    expect(getByRole('status', { name: 'Generating diagram' })).toBeTruthy();
    rerender(<Response isStreaming={false}>{text}</Response>);
    expect(await findByRole('figure', { name: 'Diagram' })).toBeTruthy();
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(Array.from(document.body.children)).toEqual([container]);
  });

  it.each([true, false])('server-renders deterministic pending markup without DOM work (streaming=%s)', (isStreaming) => {
    const html = renderToStaticMarkup(streamingCode('graph TD\n  A-->B', isStreaming));
    expect(html).toContain('Generating diagram');
    expect(html).not.toContain('<svg');
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('escapes invalid diagram source in the raw-code fallback', async () => {
    mermaid.parse.mockResolvedValueOnce(false);
    const code = '<img src=x onerror="alert(1)">';
    const { container, findByRole } = render(streamingCode(code, false));
    expect(await findByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toBe(code);
    expect(container.querySelector('img')).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('preserves hook order when switching inline and fenced forms', async () => {
    const { rerender, findByRole } = render(<MermaidCode inline>graph TD</MermaidCode>);
    rerender(<MermaidCode className="language-mermaid">{'graph TD\n  A-->B'}</MermaidCode>);
    expect(await findByRole('figure', { name: 'Diagram' })).toBeTruthy();
    expect(() => rerender(<MermaidCode inline>graph TD</MermaidCode>)).not.toThrow();
  });

  it('leaves inline code untouched even while streaming', async () => {
    const { container, queryByRole } = render(
      <ResponseStreamingContext.Provider value><MermaidCode inline>graph TD</MermaidCode></ResponseStreamingContext.Provider>,
    );
    await act(async () => {});
    expect(container.querySelector('code')?.textContent).toBe('graph TD');
    expect(queryByRole('status')).toBeNull();
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});

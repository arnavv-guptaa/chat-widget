/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageAttachments } from '../src/components/message-attachments';
import { filePartDetails } from '../src/utils/file-parts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('managed outputs reuse the existing file card', () => {
  it('reads filename/size from the strict SDK file chunk metadata', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const details = filePartDetails({
      type: 'file', mediaType: 'application/pdf', url: 'https://storage.example/signed',
      providerMetadata: { mordn: { sandboxFile: { filename: 'Report.pdf', size: 2048, storagePath: 'managed-artifact/ref' } } },
    });
    render(<MessageAttachments attachments={[details]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report.pdf' }));
    expect(screen.getByText('Report.pdf')).toBeTruthy();
    expect(screen.getByText(/2.0 KB|2 KB/)).toBeTruthy();
    expect(open).toHaveBeenCalledWith('https://storage.example/signed', '_blank', 'noopener,noreferrer');
  });

  it('shows unavailable instead of a broken URL or active fallback link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<MessageAttachments attachments={[{ filename: 'Report.pdf', mediaType: 'application/pdf', url: '' }]} />);
    const button = screen.getByRole('button', { name: 'Report.pdf — unavailable' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
  });
});

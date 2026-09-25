import { render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

describe('DropZone', () => {
  it('invites the user to upload when idle', () => {
    render(<DropZone onFiles={vi.fn()} uploading={false} />);
    expect(screen.getByText('Click to upload or drag and drop')).toBeInTheDocument();
    expect(screen.getByText(/up to 20MB/)).toBeInTheDocument();
  });

  it('shows a busy state while an upload is in flight', () => {
    render(<DropZone onFiles={vi.fn()} uploading />);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
  });
});

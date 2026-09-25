import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Card, LocalUpload } from '../state/uploadsReducer';
import { SkeletonTile } from './SkeletonTile';

const baseCard: Card = {
  key: 'k',
  name: 'selfie.jpg',
  sizeBytes: 34_000,
  status: 'uploading',
  progress: 0.42,
  reasons: [],
  previews: [],
  image: null,
  upload: { localId: 'local-1' } as LocalUpload,
  sortKey: 0,
};

describe('SkeletonTile', () => {
  it('shows upload progress', () => {
    render(<SkeletonTile card={baseCard} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('cancels an in-flight upload', async () => {
    const onDismiss = vi.fn();
    render(<SkeletonTile card={baseCard} onRetry={vi.fn()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selfie.jpg' }));
    expect(onDismiss).toHaveBeenCalledWith('local-1');
  });

  it('offers retry after a failed upload', async () => {
    const onRetry = vi.fn();
    const upload = { localId: 'local-1', error: 'Network error' } as LocalUpload;
    render(
      <SkeletonTile
        card={{ ...baseCard, status: 'upload-error', progress: null, upload }}
        onRetry={onRetry}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledWith('local-1');
  });
});

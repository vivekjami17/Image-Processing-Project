import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageDto } from '../api/types';
import type { Card, LocalUpload } from '../state/uploadsReducer';
import { ImageCard } from './ImageCard';

const baseCard: Card = {
  key: 'k',
  name: 'portrait.jpg',
  sizeBytes: 34_000,
  status: 'rejected',
  progress: null,
  reasons: [],
  previews: [],
  image: null,
  upload: null,
  sortKey: 0,
};

const actions = () => ({ onRetry: vi.fn(), onDismiss: vi.fn(), onDelete: vi.fn() });

describe('ImageCard', () => {
  it('lists every rejection reason', () => {
    render(
      <ImageCard
        card={{
          ...baseCard,
          image: { id: 'img-1', format: 'jpeg', width: 600, height: 600, urls: {}, error: null } as ImageDto,
          reasons: [
            { code: 'BLURRY', message: 'Image is too blurry.' },
            { code: 'MULTIPLE_FACES', message: '3 faces detected; only one is allowed.' },
          ],
        }}
        {...actions()}
      />,
    );
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('600×600', { exact: false })).toBeInTheDocument();
    const reasons = screen.getByRole('list', { name: 'Reasons for rejection' });
    expect(reasons).toHaveTextContent('Image is too blurry.');
    expect(reasons).toHaveTextContent('3 faces detected');
  });

  it('shows upload progress', () => {
    render(<ImageCard card={{ ...baseCard, status: 'uploading', progress: 0.42 }} {...actions()} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('offers retry after a failed upload', async () => {
    const handlers = actions();
    const upload = { localId: 'local-1', error: 'Network error' } as LocalUpload;
    render(<ImageCard card={{ ...baseCard, status: 'upload-error', upload }} {...handlers} />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(handlers.onRetry).toHaveBeenCalledWith('local-1');
  });

  it('shows a HEIC placeholder until the server thumbnail exists', () => {
    render(<ImageCard card={{ ...baseCard, name: 'IMG_1.HEIC', status: 'processing' }} {...actions()} />);
    expect(screen.getByText('HEIC preview after processing')).toBeInTheDocument();
  });
});

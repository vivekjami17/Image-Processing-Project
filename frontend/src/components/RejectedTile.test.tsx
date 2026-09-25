import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Card } from '../state/uploadsReducer';
import { RejectedTile } from './RejectedTile';

const baseCard: Card = {
  key: 'k',
  name: 'blurry.jpg',
  sizeBytes: 34_000,
  status: 'rejected',
  progress: null,
  reasons: [{ code: 'BLURRY', message: 'Image is too blurry (sharpness 12, minimum 50).' }],
  previews: [],
  image: null,
  upload: null,
  sortKey: 0,
};

describe('RejectedTile', () => {
  it('maps the rejection code to a short label', () => {
    render(<RejectedTile card={baseCard} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Blurry face detected' })).toBeInTheDocument();
  });

  it('shows a friendly explanation plus the server reason in the tooltip', () => {
    render(<RejectedTile card={baseCard} onDelete={vi.fn()} />);
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.getByText(/too blurry to use/)).toBeInTheDocument();
    expect(screen.getByText('Image is too blurry (sharpness 12, minimum 50).')).toBeInTheDocument();
  });

  it('flags extra reasons on the label when more than one check failed', () => {
    render(
      <RejectedTile
        card={{
          ...baseCard,
          reasons: [
            { code: 'BLURRY', message: 'Image is too blurry.' },
            { code: 'FACE_TOO_SMALL', message: 'Face fills 10% of the image height; it must fill at least 15%.' },
          ],
        }}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Blurry face detected +1' })).toBeInTheDocument();
  });

  it('deletes the image when the trash button is clicked', async () => {
    const onDelete = vi.fn();
    render(
      <RejectedTile
        card={{ ...baseCard, image: { id: 'img-9', format: 'jpeg', width: 100, height: 100, urls: {}, error: null } as never }}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete blurry.jpg' }));
    expect(onDelete).toHaveBeenCalledWith('img-9');
  });
});

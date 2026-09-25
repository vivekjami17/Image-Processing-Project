import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageDto } from '../api/types';
import type { Card } from '../state/uploadsReducer';
import { AcceptedTile } from './AcceptedTile';

const baseCard: Card = {
  key: 'k',
  name: 'portrait.jpg',
  sizeBytes: 34_000,
  status: 'accepted',
  progress: null,
  reasons: [],
  previews: ['/thumb.jpg'],
  image: { id: 'img-1', format: 'jpeg', width: 600, height: 600, urls: { thumbnail: '/thumb.jpg' }, error: null } as ImageDto,
  upload: null,
  sortKey: 0,
};

describe('AcceptedTile', () => {
  it('renders the thumbnail and deletes on click', async () => {
    const onDelete = vi.fn();
    render(<AcceptedTile card={baseCard} onDelete={onDelete} />);
    expect(screen.getByRole('img', { name: 'portrait.jpg' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete portrait.jpg' }));
    expect(onDelete).toHaveBeenCalledWith('img-1');
  });

  it('shows a HEIC placeholder until the server thumbnail exists', () => {
    render(
      <AcceptedTile
        card={{
          ...baseCard,
          name: 'IMG_1.HEIC',
          previews: [],
          image: { id: 'img-2', format: 'heic', width: null, height: null, urls: { thumbnail: null }, error: null } as ImageDto,
        }}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('HEIC preview after processing')).toBeInTheDocument();
  });
});

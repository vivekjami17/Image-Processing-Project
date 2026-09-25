import type { Card, SectionPaging } from '../state/uploadsReducer';
import { RejectedTile } from './RejectedTile';

interface Props {
  cards: Card[];
  paging: SectionPaging;
  onDelete: (imageId: string) => void;
  onLoadMore: () => void;
}

/** Light-red card listing photos that failed a check. Replacing them is optional. */
export function RejectedPanel({ cards, paging, onDelete, onLoadMore }: Props) {
  if (cards.length === 0 && !paging.loading) return null;

  return (
    <section className="rejected-panel" aria-label="Photos that didn't meet our guidelines">
      <h2>Some Photos Didn't Meet Our Guidelines</h2>
      <p className="rejected-panel__subtitle">Replacing these is optional.</p>

      <ul className="grid">
        {cards.map((card) => (
          <RejectedTile key={card.key} card={card} onDelete={onDelete} />
        ))}
      </ul>

      {(paging.hasMore || paging.loading) && (
        <button type="button" className="btn btn--ghost" onClick={onLoadMore} disabled={paging.loading}>
          {paging.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}

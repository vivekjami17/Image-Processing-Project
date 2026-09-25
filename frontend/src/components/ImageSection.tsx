import type { ReactNode } from 'react';
import type { Card, SectionPaging } from '../state/uploadsReducer';
import { ImageCard } from './ImageCard';

interface Props {
  title: string;
  tone: 'neutral' | 'good' | 'bad';
  cards: Card[];
  paging: SectionPaging;
  empty: ReactNode;
  onLoadMore: () => void;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
  onDelete: (imageId: string) => void;
}

export function ImageSection({ title, tone, cards, paging, empty, onLoadMore, ...cardActions }: Props) {
  const headingId = `section-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className={`section section--${tone}`} aria-labelledby={headingId}>
      <header className="section__header">
        <h2 id={headingId}>{title}</h2>
        <span className="section__count" aria-label={`${cards.length}${paging.hasMore ? ' or more' : ''} images`}>
          {cards.length}
          {paging.hasMore && '+'}
        </span>
      </header>

      {cards.length === 0 && !paging.loading ? (
        <p className="section__empty">{empty}</p>
      ) : (
        <ul className="grid">
          {cards.map((card) => (
            <ImageCard key={card.key} card={card} {...cardActions} />
          ))}
        </ul>
      )}

      {(paging.hasMore || paging.loading) && (
        <button type="button" className="btn btn--ghost section__more" onClick={onLoadMore} disabled={paging.loading}>
          {paging.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}

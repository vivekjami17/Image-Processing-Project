import type { Card, SectionPaging } from '../state/uploadsReducer';
import { AcceptedTile } from './AcceptedTile';
import { ProgressHeader } from './ProgressHeader';
import { SkeletonTile } from './SkeletonTile';

interface Props {
  processing: Card[];
  accepted: Card[];
  acceptedPaging: SectionPaging;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
  onDelete: (imageId: string) => void;
  onLoadMoreAccepted: () => void;
}

/**
 * The "Uploaded Images" header, its progress bar, and a single grid that carries
 * a photo from a blurred, in-progress tile through to its accepted thumbnail —
 * without the tile ever changing position or key.
 */
export function AcceptedSection({
  processing,
  accepted,
  acceptedPaging,
  onRetry,
  onDismiss,
  onDelete,
  onLoadMoreAccepted,
}: Props) {
  const combined = [...processing, ...accepted].sort((a, b) => b.sortKey - a.sortKey);

  return (
    <div className="accepted-section">
      <ProgressHeader acceptedCount={accepted.length} />

      {processing.length > 0 && (
        <p className="accepted-section__notice" aria-live="polite">
          We're verifying the quality of your uploads…
        </p>
      )}

      {combined.length === 0 && !acceptedPaging.loading ? (
        <p className="accepted-section__empty">Your accepted photos will appear here.</p>
      ) : (
        <ul className="grid">
          {combined.map((card) =>
            card.status === 'accepted' ? (
              <AcceptedTile key={card.key} card={card} onDelete={onDelete} />
            ) : (
              <SkeletonTile key={card.key} card={card} onRetry={onRetry} onDismiss={onDismiss} />
            ),
          )}
        </ul>
      )}

      {(acceptedPaging.hasMore || acceptedPaging.loading) && (
        <button type="button" className="btn btn--ghost" onClick={onLoadMoreAccepted} disabled={acceptedPaging.loading}>
          {acceptedPaging.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

import { memo } from 'react';
import { formatBytes } from '../lib/format';
import type { Card } from '../state/uploadsReducer';
import { Preview } from './Preview';
import { StatusBadge } from './StatusBadge';

interface Props {
  card: Card;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
  onDelete: (imageId: string) => void;
}

export const ImageCard = memo(function ImageCard({ card, onRetry, onDismiss, onDelete }: Props) {
  const { image, upload } = card;
  const isHeic = image?.format === 'heic' || /\.heic$/i.test(card.name);
  const busy = card.status === 'processing' || card.status === 'pending';

  const meta = [
    formatBytes(card.sizeBytes),
    image?.width && image.height ? `${image.width}×${image.height}` : null,
    image?.format?.toUpperCase(),
  ].filter(Boolean);

  return (
    <li className={`card card--${card.status}`}>
      <div className="card__media">
        <Preview
          sources={card.previews}
          alt={card.name}
          placeholder={isHeic && !image?.urls.thumbnail ? 'HEIC preview after processing' : 'No preview'}
        />
        <div className="card__badge">
          <StatusBadge status={card.status} />
        </div>
        {card.progress !== null && (
          <div
            className="progress"
            role="progressbar"
            aria-label={`Uploading ${card.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(card.progress * 100)}
          >
            <div className="progress__bar" style={{ transform: `scaleX(${card.progress})` }} />
          </div>
        )}
        {busy && <div className="card__scan" aria-hidden="true" />}
      </div>

      <div className="card__body">
        <p className="card__name" title={card.name}>
          {card.name}
        </p>
        <p className="card__meta">{meta.join(' · ')}</p>

        {card.reasons.length > 0 && (
          <ul className="card__reasons" aria-label="Reasons for rejection">
            {card.reasons.map((r) => (
              <li key={r.code}>{r.message}</li>
            ))}
          </ul>
        )}
        {image?.error && <p className="card__error">{image.error}</p>}
        {upload?.error && card.status === 'upload-error' && <p className="card__error">{upload.error}</p>}

        <div className="card__actions">
          {card.status === 'upload-error' && upload && (
            <button type="button" className="btn btn--small" onClick={() => onRetry(upload.localId)}>
              Retry
            </button>
          )}
          {image?.urls.processed && card.status === 'accepted' && (
            <a className="btn btn--small btn--ghost" href={image.urls.processed} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
          {image ? (
            <button type="button" className="btn btn--small btn--ghost btn--danger" onClick={() => onDelete(image.id)}>
              Delete
            </button>
          ) : (
            upload && (
              <button type="button" className="btn btn--small btn--ghost" onClick={() => onDismiss(upload.localId)}>
                {card.status === 'uploading' || card.status === 'queued' ? 'Cancel' : 'Dismiss'}
              </button>
            )
          )}
        </div>
      </div>
    </li>
  );
});

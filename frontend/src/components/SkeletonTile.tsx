import type { Card } from '../state/uploadsReducer';
import { CloseIcon, RetryIcon } from './icons';

interface Props {
  card: Card;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

const STATUS_TEXT: Record<string, string> = {
  validating: 'Checking file',
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  pending: 'Queued for analysis',
  processing: 'Analyzing photo',
  'upload-error': 'Upload failed',
};

/** A blurred placeholder tile for a photo that is still uploading or being analyzed. */
export function SkeletonTile({ card, onRetry, onDismiss }: Props) {
  const preview = card.previews[0];
  const isError = card.status === 'upload-error';

  return (
    <li className={`tile tile--skeleton${isError ? ' tile--error' : ''}`}>
      <div className="tile__frame">
        {preview ? (
          <img className="tile__img tile__img--blurred" src={preview} alt="" aria-hidden="true" />
        ) : (
          <div className="tile__shimmer" aria-hidden="true" />
        )}
        <div className="tile__scrim">
          {isError ? (
            <>
              <span className="tile__error-text">Upload failed</span>
              {card.upload && (
                <button type="button" className="tile__retry" onClick={() => onRetry(card.upload!.localId)}>
                  <RetryIcon /> Retry
                </button>
              )}
            </>
          ) : (
            <span className="spinner spinner--lg" aria-hidden="true" />
          )}
        </div>
        {card.progress !== null && (
          <div
            className="tile__progress"
            role="progressbar"
            aria-label={`Uploading ${card.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(card.progress * 100)}
          >
            <div className="tile__progress-fill" style={{ width: `${Math.round(card.progress * 100)}%` }} />
          </div>
        )}
        {card.upload && (
          <button
            type="button"
            className="tile__delete"
            onClick={() => onDismiss(card.upload!.localId)}
            aria-label={`Cancel ${card.name}`}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <span className="visually-hidden">
        {card.name} — {STATUS_TEXT[card.status] ?? card.status}
        {card.upload?.error ? `: ${card.upload.error}` : ''}
      </span>
    </li>
  );
}

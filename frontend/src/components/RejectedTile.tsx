import { useId } from 'react';
import type { Card } from '../state/uploadsReducer';
import { reasonCopy } from '../lib/rejectionLabels';
import { TrashIcon } from './icons';
import { Preview } from './Preview';

interface Props {
  card: Card;
  onDelete: (imageId: string) => void;
}

/**
 * A rejected photo: thumbnail, delete button, and an underlined label mapped from
 * the rejection code. Hovering (or focusing) the label reveals a tooltip with a
 * friendly explanation plus the server's exact reason.
 */
export function RejectedTile({ card, onDelete }: Props) {
  const tooltipId = useId();
  const isHeic = card.image?.format === 'heic' || /\.heic$/i.test(card.name);
  const primary = card.reasons[0];
  const extra = card.reasons.length - 1;

  return (
    <li className="tile tile--rejected">
      <div className="tile__frame">
        <Preview
          sources={card.previews}
          alt={card.name}
          placeholder={isHeic && !card.image?.urls.thumbnail ? 'HEIC preview after processing' : 'No preview'}
        />
        {card.image && (
          <button
            type="button"
            className="tile__delete"
            onClick={() => onDelete(card.image!.id)}
            aria-label={`Delete ${card.name}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {primary && (
        <div className="tile__caption">
          <button type="button" className="tile__label" aria-describedby={tooltipId}>
            {reasonCopy(primary.code).label}
            {extra > 0 && ` +${extra}`}
          </button>
          <div id={tooltipId} role="tooltip" className="tile__tooltip">
            <p className="tile__tooltip-title">Try again</p>
            {card.reasons.map((r) => (
              <p key={r.code}>
                {reasonCopy(r.code).explain} <span className="tile__tooltip-reason">{r.message}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

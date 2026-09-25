import type { Card } from '../state/uploadsReducer';
import { TrashIcon } from './icons';
import { Preview } from './Preview';

interface Props {
  card: Card;
  onDelete: (imageId: string) => void;
}

/** A single accepted photo: a rounded thumbnail with a delete button in the corner. */
export function AcceptedTile({ card, onDelete }: Props) {
  const isHeic = card.image?.format === 'heic' || /\.heic$/i.test(card.name);
  return (
    <li className="tile tile--accepted">
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
    </li>
  );
}

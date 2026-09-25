import type { CardStatus } from '../state/uploadsReducer';

const LABELS: Record<CardStatus, string> = {
  validating: 'Checking',
  queued: 'Waiting',
  uploading: 'Uploading',
  pending: 'Queued',
  processing: 'Analyzing',
  accepted: 'Accepted',
  rejected: 'Rejected',
  failed: 'Failed',
  'upload-error': 'Upload failed',
};

const TONES: Record<CardStatus, 'neutral' | 'busy' | 'good' | 'bad'> = {
  validating: 'busy',
  queued: 'neutral',
  uploading: 'busy',
  pending: 'neutral',
  processing: 'busy',
  accepted: 'good',
  rejected: 'bad',
  failed: 'bad',
  'upload-error': 'bad',
};

export function StatusBadge({ status }: { status: CardStatus }) {
  const tone = TONES[status];
  return (
    <span className={`badge badge--${tone}`}>
      {tone === 'busy' && <span className="badge__spinner" aria-hidden="true" />}
      {LABELS[status]}
    </span>
  );
}

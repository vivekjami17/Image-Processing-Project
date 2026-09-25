const TARGET = 10;

interface Props {
  acceptedCount: number;
}

/** "Uploaded Images" header with a thin bar that fills green as photos are accepted. */
export function ProgressHeader({ acceptedCount }: Props) {
  const pct = Math.min(100, Math.round((acceptedCount / TARGET) * 100));
  return (
    <div className="progress-header">
      <div className="progress-header__row">
        <h2>Uploaded Images</h2>
        <span className="progress-header__count">
          {acceptedCount} of {TARGET}
        </span>
      </div>
      <div
        className="progress-header__bar"
        role="progressbar"
        aria-label="Accepted photos"
        aria-valuemin={0}
        aria-valuemax={TARGET}
        aria-valuenow={acceptedCount}
      >
        <div className="progress-header__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

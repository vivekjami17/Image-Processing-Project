import { DropZone } from './components/DropZone';
import { ImageSection } from './components/ImageSection';
import { useImageUploads } from './hooks/useImageUploads';

const CONNECTION_LABEL = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…' } as const;

export default function App() {
  const { sections, paging, connection, notice, dismissNotice, addFiles, retryUpload, dismissUpload, removeImage, loadMore } =
    useImageUploads();
  const cardActions = { onRetry: retryUpload, onDismiss: dismissUpload, onDelete: removeImage };

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Photo uploads</h1>
          <p className="app__subtitle">
            Each photo is checked for format, size, resolution, sharpness, duplicates and faces.
          </p>
        </div>
        <span className={`connection connection--${connection}`} role="status">
          <span className="connection__dot" aria-hidden="true" />
          {CONNECTION_LABEL[connection]}
        </span>
      </header>

      <DropZone onFiles={addFiles} />

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="btn btn--small btn--ghost" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      {(sections.processing.length > 0 || paging.processing.hasMore) && (
        <ImageSection
          title="In progress"
          tone="neutral"
          cards={sections.processing}
          paging={paging.processing}
          empty="Nothing in progress."
          onLoadMore={() => loadMore('processing')}
          {...cardActions}
        />
      )}

      <div className="columns">
        <ImageSection
          title="Accepted"
          tone="good"
          cards={sections.accepted}
          paging={paging.accepted}
          empty="Accepted photos will appear here."
          onLoadMore={() => loadMore('accepted')}
          {...cardActions}
        />
        <ImageSection
          title="Rejected"
          tone="bad"
          cards={sections.rejected}
          paging={paging.rejected}
          empty="Photos that fail a check will appear here, with the reason."
          onLoadMore={() => loadMore('rejected')}
          {...cardActions}
        />
      </div>
    </div>
  );
}

import { AcceptedSection } from './components/AcceptedSection';
import { PhotoRequirements } from './components/PhotoRequirements';
import { RejectedPanel } from './components/RejectedPanel';
import { UploadPanel } from './components/UploadPanel';
import { useImageUploads } from './hooks/useImageUploads';

const CONNECTION_LABEL = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…' } as const;

export default function App() {
  const { sections, paging, connection, notice, dismissNotice, addFiles, retryUpload, dismissUpload, removeImage, loadMore } =
    useImageUploads();

  const isUploading = sections.processing.some(
    (card) => card.status === 'validating' || card.status === 'queued' || card.status === 'uploading',
  );

  return (
    <div className="app">
      <header className="app__header">
        <span className={`connection connection--${connection}`} role="status">
          <span className="connection__dot" aria-hidden="true" />
          {CONNECTION_LABEL[connection]}
        </span>
      </header>

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="btn btn--small btn--ghost" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      <div className="layout">
        <UploadPanel onFiles={addFiles} uploading={isUploading} />

        <div className="layout__right">
          <AcceptedSection
            processing={sections.processing}
            accepted={sections.accepted}
            acceptedPaging={paging.accepted}
            onRetry={retryUpload}
            onDismiss={dismissUpload}
            onDelete={removeImage}
            onLoadMoreAccepted={() => loadMore('accepted')}
          />

          <RejectedPanel
            cards={sections.rejected}
            paging={paging.rejected}
            onDelete={removeImage}
            onLoadMore={() => loadMore('rejected')}
          />

          <PhotoRequirements />
        </div>
      </div>
    </div>
  );
}

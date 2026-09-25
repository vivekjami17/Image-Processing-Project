import { useRef, useState, type DragEvent } from 'react';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from '../lib/validateFile';
import { UploadIcon } from './icons';

interface Props {
  onFiles: (files: File[]) => void;
  /** True while any recently-added file is still being validated or sent to the server. */
  uploading: boolean;
}

export function DropZone({ onFiles, uploading }: Props) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element; count to know when we truly left.
  const depth = useRef(0);

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current -= 1;
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    // The whole zone is a <label>, so clicking anywhere opens the file picker and the
    // (visually hidden) input stays keyboard-focusable.
    <label
      className={`dropzone${dragging ? ' dropzone--active' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={`dropzone__button${uploading ? ' dropzone__button--busy' : ''}`}>
        {uploading ? <span className="spinner" aria-hidden="true" /> : <UploadIcon />}
        {uploading ? 'Uploading…' : 'Click to upload or drag and drop'}
      </span>
      <span className="dropzone__hint">PNG, JPG, HEIC up to {Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB</span>
      <input
        className="visually-hidden"
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          // Allow picking the same file again.
          e.target.value = '';
        }}
      />
    </label>
  );
}

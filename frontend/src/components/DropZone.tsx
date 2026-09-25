import { useRef, useState, type DragEvent } from 'react';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from '../lib/validateFile';

interface Props {
  onFiles: (files: File[]) => void;
}

export function DropZone({ onFiles }: Props) {
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
      <svg className="dropzone__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      <p className="dropzone__title">
        Drag photos here or <span className="dropzone__browse">browse</span>
      </p>
      <p className="dropzone__hint">
        JPEG, PNG or HEIC · up to {MAX_FILE_BYTES / 1024 / 1024} MB each
      </p>
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

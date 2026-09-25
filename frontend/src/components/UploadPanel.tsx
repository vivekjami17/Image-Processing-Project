import { DropZone } from './DropZone';

interface Props {
  onFiles: (files: File[]) => void;
  uploading: boolean;
}

/** Left column: heading, short instructions and the dropzone. */
export function UploadPanel({ onFiles, uploading }: Props) {
  return (
    <div className="upload-panel">
      <h1 className="upload-panel__title">Upload photos</h1>
      <p className="upload-panel__intro">
        Add clear, well-lit photos in PNG, JPG or HEIC. We automatically check each one for
        sharpness, resolution, duplicates and faces so only your best shots make it through.
      </p>
      <DropZone onFiles={onFiles} uploading={uploading} />
    </div>
  );
}

/**
 * Short, human labels and hover explanations for rejection codes, shown under a
 * rejected thumbnail. Codes come from the server (backend/src/processing/rules.ts)
 * or from client-side pre-upload checks (lib/validateFile.ts); anything unlisted
 * falls back to a generic label so a new/unknown code never renders blank.
 */
export interface ReasonCopy {
  label: string;
  explain: string;
}

export const REASON_COPY: Record<string, ReasonCopy> = {
  BLURRY: {
    label: 'Blurry face detected',
    explain: "This photo came out too blurry to use.",
  },
  FACE_TOO_SMALL: {
    label: 'Face is too far away',
    explain: 'Face is too far from the camera. Please ensure the face is at an appropriate distance.',
  },
  TOO_SIMILAR: {
    label: 'Too similar to another upload',
    explain: "This looks a lot like a photo you've already uploaded.",
  },
  MULTIPLE_FACES: {
    label: 'Multiple faces detected',
    explain: 'We need exactly one face per photo, and this one has more than one.',
  },
  RESOLUTION_TOO_LOW: {
    label: 'Resolution too low',
    explain: "This image's resolution is too low for us to use.",
  },
  FILE_TOO_SMALL: {
    label: 'File too small',
    explain: 'This file is smaller than we can safely process.',
  },
  UNSUPPORTED_FORMAT: {
    label: 'Unsupported format',
    explain: 'We can only accept PNG, JPG and HEIC photos.',
  },
  CORRUPT_IMAGE: {
    label: "Couldn't read image",
    explain: "This file's contents couldn't be read as an image.",
  },
  IMAGE_TOO_LARGE: {
    label: 'Image too large',
    explain: 'This image is larger than we can process.',
  },
  FILE_TOO_LARGE: {
    label: 'File too large',
    explain: 'This file is larger than we can accept.',
  },
  EMPTY_FILE: {
    label: 'Empty file',
    explain: "This file doesn't contain any data.",
  },
  NETWORK_ERROR: {
    label: 'Upload failed',
    explain: 'A network error interrupted the upload.',
  },
};

const FALLBACK: ReasonCopy = {
  label: "Didn't meet our guidelines",
  explain: 'This photo failed one of our automatic checks.',
};

export function reasonCopy(code: string): ReasonCopy {
  return REASON_COPY[code] ?? FALLBACK;
}

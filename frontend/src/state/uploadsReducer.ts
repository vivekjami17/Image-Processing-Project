import type { ImageDto, ImageStatus, RejectionReason } from '../api/types';

/** A file chosen in this browser session, before and while it is uploaded. */
export interface LocalUpload {
  localId: string;
  file: File;
  previewUrl: string | null;
  addedAt: number;
  phase: 'validating' | 'invalid' | 'queued' | 'uploading' | 'uploaded' | 'error';
  progress: number;
  /** Client-side validation failures (phase = invalid). */
  reasons: RejectionReason[];
  error: string | null;
  /** Set once the server has accepted the upload and assigned an id. */
  imageId: string | null;
}

export type SectionId = 'processing' | 'accepted' | 'rejected';

export const SECTION_STATUSES: Record<SectionId, ImageStatus[]> = {
  processing: ['pending', 'processing'],
  accepted: ['accepted'],
  rejected: ['rejected', 'failed'],
};

export interface SectionPaging {
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
}

export interface State {
  uploads: LocalUpload[];
  images: Record<string, ImageDto>;
  paging: Record<SectionId, SectionPaging>;
}

export type Action =
  | { type: 'files/added'; uploads: LocalUpload[] }
  | { type: 'upload/validated'; localId: string; reasons: RejectionReason[] }
  | { type: 'upload/started'; localId: string }
  | { type: 'upload/progress'; localId: string; progress: number }
  | { type: 'upload/succeeded'; localId: string; image: ImageDto }
  | { type: 'upload/failed'; localId: string; error: string }
  | { type: 'upload/retried'; localId: string }
  | { type: 'upload/dismissed'; localId: string }
  | { type: 'section/loading'; section: SectionId }
  | { type: 'section/loaded'; section: SectionId; images: ImageDto[]; cursor: string | null }
  | { type: 'section/loadFailed'; section: SectionId }
  | { type: 'image/upserted'; image: ImageDto }
  | { type: 'image/removed'; id: string };

// Every section is fetched on mount, so they all start out loading.
const initialPaging = (): SectionPaging => ({ cursor: null, hasMore: false, loading: true });

export const initialState: State = {
  uploads: [],
  images: {},
  paging: { processing: initialPaging(), accepted: initialPaging(), rejected: initialPaging() },
};

const STATUS_RANK: Record<ImageStatus, number> = { pending: 0, processing: 1, accepted: 2, rejected: 2, failed: 2 };

/**
 * Events can arrive out of order: the worker may finish (and the SSE event land)
 * before the upload's own 202 response does. Never let a stale snapshot move an
 * image backwards from a final status.
 */
function upsert(images: Record<string, ImageDto>, incoming: ImageDto[]): Record<string, ImageDto> {
  const next = { ...images };
  for (const image of incoming) {
    const current = next[image.id];
    if (!current || STATUS_RANK[image.status] >= STATUS_RANK[current.status]) next[image.id] = image;
  }
  return next;
}

function updateUpload(state: State, localId: string, patch: Partial<LocalUpload>): State {
  return {
    ...state,
    uploads: state.uploads.map((u) => (u.localId === localId ? { ...u, ...patch } : u)),
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'files/added':
      return { ...state, uploads: [...action.uploads, ...state.uploads] };

    case 'upload/validated':
      return updateUpload(state, action.localId, action.reasons.length
        ? { phase: 'invalid', reasons: action.reasons }
        : { phase: 'queued' });

    case 'upload/started':
      return updateUpload(state, action.localId, { phase: 'uploading', progress: 0, error: null });

    case 'upload/progress':
      return updateUpload(state, action.localId, { progress: action.progress });

    case 'upload/succeeded':
      return {
        ...updateUpload(state, action.localId, { phase: 'uploaded', progress: 1, imageId: action.image.id }),
        images: upsert(state.images, [action.image]),
      };

    case 'upload/failed':
      return updateUpload(state, action.localId, { phase: 'error', error: action.error });

    case 'upload/retried':
      return updateUpload(state, action.localId, { phase: 'queued', progress: 0, error: null });

    case 'upload/dismissed':
      return { ...state, uploads: state.uploads.filter((u) => u.localId !== action.localId) };

    case 'section/loading':
      return { ...state, paging: { ...state.paging, [action.section]: { ...state.paging[action.section], loading: true } } };

    case 'section/loaded':
      return {
        ...state,
        images: upsert(state.images, action.images),
        paging: {
          ...state.paging,
          [action.section]: { cursor: action.cursor, hasMore: action.cursor !== null, loading: false },
        },
      };

    case 'section/loadFailed':
      return { ...state, paging: { ...state.paging, [action.section]: { ...state.paging[action.section], loading: false } } };

    case 'image/upserted':
      return { ...state, images: upsert(state.images, [action.image]) };

    case 'image/removed': {
      if (!state.images[action.id] && !state.uploads.some((u) => u.imageId === action.id)) return state;
      const { [action.id]: _removed, ...images } = state.images;
      return { ...state, images, uploads: state.uploads.filter((u) => u.imageId !== action.id) };
    }
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type CardStatus = ImageStatus | 'validating' | 'queued' | 'uploading' | 'upload-error';

/** Everything the UI needs to render one tile, whether it lives locally, on the server, or both. */
export interface Card {
  key: string;
  name: string;
  sizeBytes: number;
  status: CardStatus;
  progress: number | null;
  reasons: RejectionReason[];
  /** Preferred preview first; the UI falls back through the list if one fails to load. */
  previews: string[];
  image: ImageDto | null;
  upload: LocalUpload | null;
  sortKey: number;
}

export function selectSections(state: State): Record<SectionId, Card[]> {
  const sections: Record<SectionId, Card[]> = { processing: [], accepted: [], rejected: [] };
  const uploadsByImage = new Map(state.uploads.filter((u) => u.imageId).map((u) => [u.imageId!, u]));

  for (const image of Object.values(state.images)) {
    const upload = uploadsByImage.get(image.id) ?? null;
    sections[sectionOf(image.status)].push({
      // Keep the local key once uploaded so React doesn't remount the tile (and its preview).
      key: upload?.localId ?? image.id,
      name: image.originalFilename,
      sizeBytes: image.sizeBytes,
      status: image.status,
      progress: null,
      reasons: image.rejectionReasons,
      // Server thumbnail is EXIF-rotated and works for HEIC; the local object URL
      // shows instantly while the thumbnail doesn't exist yet.
      previews: [image.urls.thumbnail, upload?.previewUrl].filter((u): u is string => !!u),
      image,
      upload,
      sortKey: Date.parse(image.createdAt),
    });
  }

  for (const upload of state.uploads) {
    if (upload.imageId && state.images[upload.imageId]) continue;
    const card: Card = {
      key: upload.localId,
      name: upload.file.name,
      sizeBytes: upload.file.size,
      status: localStatus(upload),
      progress: upload.phase === 'uploading' ? upload.progress : null,
      reasons: upload.reasons,
      previews: upload.previewUrl ? [upload.previewUrl] : [],
      image: null,
      upload,
      sortKey: upload.addedAt,
    };
    sections[upload.phase === 'invalid' ? 'rejected' : 'processing'].push(card);
  }

  for (const cards of Object.values(sections)) cards.sort((a, b) => b.sortKey - a.sortKey);
  return sections;
}

function sectionOf(status: ImageStatus): SectionId {
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected' || status === 'failed') return 'rejected';
  return 'processing';
}

function localStatus(upload: LocalUpload): CardStatus {
  switch (upload.phase) {
    case 'validating':
      return 'validating';
    case 'invalid':
      return 'rejected';
    case 'queued':
      return 'queued';
    case 'uploading':
    case 'uploaded':
      return 'uploading';
    case 'error':
      return 'upload-error';
  }
}

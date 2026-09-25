import type { ImageDto } from '../api/types';
import { initialState, reducer, selectSections, type Action, type LocalUpload, type State } from './uploadsReducer';

const image = (overrides: Partial<ImageDto> = {}): ImageDto => ({
  id: 'img-1',
  originalFilename: 'me.jpg',
  format: 'jpeg',
  sizeBytes: 50_000,
  width: null,
  height: null,
  status: 'pending',
  rejectionReasons: [],
  metrics: { blurScore: null, faceCount: null, faceHeightRatio: null },
  similarToId: null,
  urls: { thumbnail: null, processed: null, original: '/api/images/img-1/original' },
  error: null,
  createdAt: '2026-09-25T10:00:00.000Z',
  processedAt: null,
  ...overrides,
});

const upload = (overrides: Partial<LocalUpload> = {}): LocalUpload => ({
  localId: 'local-1',
  file: new File(['x'], 'me.jpg', { type: 'image/jpeg' }),
  previewUrl: 'blob:preview-1',
  addedAt: 1,
  phase: 'validating',
  progress: 0,
  reasons: [],
  error: null,
  imageId: null,
  ...overrides,
});

const run = (...actions: Action[]): State => actions.reduce(reducer, initialState);

describe('uploads reducer', () => {
  it('moves a valid file through validation, upload and processing', () => {
    let state = run({ type: 'files/added', uploads: [upload()] }, { type: 'upload/validated', localId: 'local-1', reasons: [] });
    expect(selectSections(state).processing[0]).toMatchObject({ status: 'queued' });

    state = reducer(state, { type: 'upload/started', localId: 'local-1' });
    state = reducer(state, { type: 'upload/progress', localId: 'local-1', progress: 0.5 });
    expect(selectSections(state).processing[0]).toMatchObject({ status: 'uploading', progress: 0.5 });

    state = reducer(state, { type: 'upload/succeeded', localId: 'local-1', image: image() });
    const [card] = selectSections(state).processing;
    expect(card).toMatchObject({ key: 'local-1', status: 'pending', previews: ['blob:preview-1'] });
    expect(card?.image?.id).toBe('img-1');

    state = reducer(state, {
      type: 'image/upserted',
      image: image({ status: 'accepted', urls: { thumbnail: '/thumb', processed: '/p', original: '/o' } }),
    });
    const sections = selectSections(state);
    expect(sections.processing).toHaveLength(0);
    expect(sections.accepted[0]?.previews).toEqual(['/thumb', 'blob:preview-1']);
  });

  it('files failing client validation go straight to rejected without a server id', () => {
    const state = run(
      { type: 'files/added', uploads: [upload()] },
      { type: 'upload/validated', localId: 'local-1', reasons: [{ code: 'UNSUPPORTED_FORMAT', message: 'nope' }] },
    );
    const { rejected, processing } = selectSections(state);
    expect(processing).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ status: 'rejected', image: null, reasons: [{ code: 'UNSUPPORTED_FORMAT' }] });
  });

  it('keeps a final status when a stale pending snapshot arrives late', () => {
    // The worker's SSE event beat the upload's 202 response.
    const state = run(
      { type: 'files/added', uploads: [upload({ phase: 'uploading' })] },
      { type: 'image/upserted', image: image({ status: 'rejected' }) },
      { type: 'upload/succeeded', localId: 'local-1', image: image({ status: 'pending' }) },
    );
    expect(state.images['img-1']?.status).toBe('rejected');
    expect(selectSections(state).rejected).toHaveLength(1);
  });

  it('supports retrying a failed upload', () => {
    let state = run(
      { type: 'files/added', uploads: [upload({ phase: 'uploading' })] },
      { type: 'upload/failed', localId: 'local-1', error: 'Network error' },
    );
    expect(selectSections(state).processing[0]).toMatchObject({ status: 'upload-error' });
    state = reducer(state, { type: 'upload/retried', localId: 'local-1' });
    expect(state.uploads[0]).toMatchObject({ phase: 'queued', error: null });
  });

  it('removes an image and its local upload together', () => {
    const state = run(
      { type: 'files/added', uploads: [upload({ phase: 'uploading' })] },
      { type: 'upload/succeeded', localId: 'local-1', image: image() },
      { type: 'image/removed', id: 'img-1' },
    );
    expect(state.images).toEqual({});
    expect(state.uploads).toEqual([]);
  });

  it('merges paged results and orders newest first', () => {
    const state = run(
      { type: 'section/loading', section: 'accepted' },
      {
        type: 'section/loaded',
        section: 'accepted',
        cursor: 'next',
        images: [
          image({ id: 'old', status: 'accepted', createdAt: '2026-01-01T00:00:00Z' }),
          image({ id: 'new', status: 'accepted', createdAt: '2026-06-01T00:00:00Z' }),
        ],
      },
    );
    expect(state.paging.accepted).toEqual({ cursor: 'next', hasMore: true, loading: false });
    expect(selectSections(state).accepted.map((c) => c.key)).toEqual(['new', 'old']);
  });
});

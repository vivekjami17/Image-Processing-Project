import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError, deleteImage, listImages, uploadImage } from '../api/client';
import type { ServerEvent } from '../api/types';
import { validateFile } from '../lib/validateFile';
import {
  initialState,
  reducer,
  SECTION_STATUSES,
  selectSections,
  type LocalUpload,
  type SectionId,
} from '../state/uploadsReducer';
import { useImageEvents } from './useImageEvents';

const MAX_PARALLEL_UPLOADS = 3;
const SECTIONS: SectionId[] = ['processing', 'accepted', 'rejected'];

/**
 * Owns the whole upload lifecycle: client-side validation, a bounded upload queue
 * with per-file progress, loading existing images, and live status updates.
 */
export function useImageUploads() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [notice, setNotice] = useState<string | null>(null);

  // Side-channel bookkeeping that must not trigger renders.
  const started = useRef(new Set<string>());
  const aborts = useRef(new Map<string, AbortController>());
  const objectUrls = useRef(new Set<string>());

  // ---- Loading existing images --------------------------------------------

  // Callers mark the section as loading; the initial state already does for the first load.
  const fetchSection = useCallback(async (section: SectionId, cursor: string | null = null) => {
    try {
      const page = await listImages({ status: SECTION_STATUSES[section], cursor });
      dispatch({ type: 'section/loaded', section, images: page.data, cursor: page.nextCursor });
    } catch (err) {
      dispatch({ type: 'section/loadFailed', section });
      setNotice(`Couldn't load images: ${errorMessage(err)}`);
    }
  }, []);

  useEffect(() => {
    // State is only set after the awaited fetch resolves, not synchronously in the effect.
    // oxlint-disable-next-line react/set-state-in-effect
    for (const section of SECTIONS) void fetchSection(section);
  }, [fetchSection]);

  const reloadAll = useCallback(() => {
    for (const section of SECTIONS) {
      dispatch({ type: 'section/loading', section });
      void fetchSection(section);
    }
  }, [fetchSection]);

  const loadMore = useCallback(
    (section: SectionId) => {
      const { cursor, loading } = state.paging[section];
      if (!cursor || loading) return;
      dispatch({ type: 'section/loading', section });
      void fetchSection(section, cursor);
    },
    [state.paging, fetchSection],
  );

  // ---- Live updates ---------------------------------------------------------

  const onEvent = useCallback((event: ServerEvent) => {
    if (event.type === 'image.updated') dispatch({ type: 'image/upserted', image: event.image });
    else if (event.type === 'image.deleted') dispatch({ type: 'image/removed', id: event.id });
  }, []);

  const connection = useImageEvents(onEvent, reloadAll);

  // ---- Adding files -----------------------------------------------------------

  const addFiles = useCallback((files: File[]) => {
    const uploads: LocalUpload[] = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      return {
        localId: crypto.randomUUID(),
        file,
        previewUrl,
        addedAt: Date.now(),
        phase: 'validating',
        progress: 0,
        reasons: [],
        error: null,
        imageId: null,
      };
    });
    dispatch({ type: 'files/added', uploads });

    for (const upload of uploads) {
      void validateFile(upload.file).then((reasons) =>
        dispatch({ type: 'upload/validated', localId: upload.localId, reasons }),
      );
    }
  }, []);

  // ---- Upload queue -----------------------------------------------------------

  const startUpload = useCallback(async (upload: LocalUpload) => {
    const controller = new AbortController();
    aborts.current.set(upload.localId, controller);
    dispatch({ type: 'upload/started', localId: upload.localId });
    try {
      const image = await uploadImage(upload.file, {
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: 'upload/progress', localId: upload.localId, progress }),
      });
      dispatch({ type: 'upload/succeeded', localId: upload.localId, image });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      dispatch({ type: 'upload/failed', localId: upload.localId, error: errorMessage(err) });
    } finally {
      aborts.current.delete(upload.localId);
      started.current.delete(upload.localId);
    }
  }, []);

  // Whenever the queue changes, fill free upload slots with queued files.
  useEffect(() => {
    const active = state.uploads.filter((u) => u.phase === 'uploading').length;
    const next = state.uploads
      .filter((u) => u.phase === 'queued' && !started.current.has(u.localId))
      .reverse() // uploads are stored newest-first; send in the order they were added
      .slice(0, Math.max(0, MAX_PARALLEL_UPLOADS - active));
    for (const upload of next) {
      started.current.add(upload.localId);
      void startUpload(upload);
    }
  }, [state.uploads, startUpload]);

  const retryUpload = useCallback((localId: string) => dispatch({ type: 'upload/retried', localId }), []);

  const dismissUpload = useCallback(
    (localId: string) => {
      aborts.current.get(localId)?.abort();
      const upload = state.uploads.find((u) => u.localId === localId);
      if (upload?.previewUrl) {
        URL.revokeObjectURL(upload.previewUrl);
        objectUrls.current.delete(upload.previewUrl);
      }
      dispatch({ type: 'upload/dismissed', localId });
    },
    [state.uploads],
  );

  // ---- Deleting ---------------------------------------------------------------

  const removeImage = useCallback(async (id: string) => {
    try {
      await deleteImage(id);
      dispatch({ type: 'image/removed', id });
    } catch (err) {
      setNotice(`Couldn't delete image: ${errorMessage(err)}`);
    }
  }, []);

  // Release object URLs and cancel in-flight uploads when the page goes away.
  useEffect(() => {
    const urls = objectUrls.current;
    const controllers = aborts.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  const sections = useMemo(() => selectSections(state), [state]);

  return {
    sections,
    paging: state.paging,
    connection,
    notice,
    dismissNotice: () => setNotice(null),
    addFiles,
    retryUpload,
    dismissUpload,
    removeImage,
    loadMore,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}

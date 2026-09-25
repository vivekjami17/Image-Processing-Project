import type { ImageDto, ImageStatus, Page } from './types';

const BASE = '/api/images';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? res.statusText);
}

export async function listImages(opts: { status: ImageStatus[]; cursor?: string | null; limit?: number }): Promise<Page<ImageDto>> {
  const params = new URLSearchParams({ status: opts.status.join(','), limit: String(opts.limit ?? 24) });
  if (opts.cursor) params.set('cursor', opts.cursor);
  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<Page<ImageDto>>;
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await parseError(res);
}

/**
 * Upload one file. XHR rather than fetch because fetch still can't report upload
 * progress. Resolves with the server's record (status `pending`, or `rejected` if the
 * server refused the file outright).
 */
export function uploadImage(
  file: File,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ImageDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { data?: ImageDto[]; error?: { code: string; message: string } } | null;
      const image = body?.data?.[0];
      if (xhr.status === 202 && image) return resolve(image);
      reject(new ApiError(xhr.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Network error. Check your connection and retry.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append('images', file, file.name);
    xhr.send(form);
  });
}

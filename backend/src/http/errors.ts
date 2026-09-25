import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { InvalidCursorError } from '../images/imageRepository.js';
import type { Logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);

const MULTER_ERRORS: Partial<Record<multer.MulterError['code'], [number, string]>> = {
  LIMIT_FILE_SIZE: [413, 'File exceeds the maximum upload size'],
  LIMIT_FILE_COUNT: [400, 'Too many files in one request'],
  LIMIT_UNEXPECTED_FILE: [400, 'Unexpected file field; use "images"'],
  LIMIT_PART_COUNT: [400, 'Too many parts in multipart request'],
  LIMIT_FIELD_COUNT: [400, 'Too many fields in multipart request'],
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    let status = 500;
    let body = { code: 'INTERNAL_ERROR', message: 'Something went wrong' } as { code: string; message: string; details?: unknown };

    if (err instanceof HttpError) {
      status = err.status;
      body = { code: err.code, message: err.message };
    } else if (err instanceof multer.MulterError) {
      const [s, message] = MULTER_ERRORS[err.code] ?? [400, err.message];
      status = s;
      body = { code: err.code, message };
    } else if (err instanceof z.ZodError) {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Invalid request', details: z.flattenError(err).fieldErrors };
    } else if (err instanceof InvalidCursorError) {
      status = 400;
      body = { code: 'INVALID_CURSOR', message: err.message };
    } else if (isClientHttpError(err)) {
      // http-errors raised by Express middleware (body parser limits, static 404s...).
      status = err.status;
      body = { code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: err.expose ? err.message : 'Bad request' };
    }

    if (status >= 500) logger.error({ err }, 'unhandled error');
    res.status(status).json({ error: body });
  };
}

function isClientHttpError(err: unknown): err is { status: number; expose?: boolean; message: string } {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

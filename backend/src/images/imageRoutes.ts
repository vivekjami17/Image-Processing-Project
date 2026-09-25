import { type RequestHandler, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import type { Config } from '../config.js';
import { HttpError, notFound } from '../http/errors.js';
import type { ObjectStorage } from '../storage/index.js';
import type { EventHub } from './eventHub.js';
import { toImageDto } from './imageDto.js';
import { IMAGE_STATUSES, type ImageRepository, UUID_RE } from './imageRepository.js';
import type { ImageService } from './imageService.js';

interface Deps {
  config: Config;
  repo: ImageRepository;
  service: ImageService;
  storage: ObjectStorage;
  events: EventHub;
}

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(IMAGE_STATUSES)).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

const VARIANTS = { original: 'original_key', processed: 'processed_key', thumbnail: 'thumbnail_key' } as const;

export function imageRoutes({ config, repo, service, storage, events }: Deps): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.MAX_UPLOAD_BYTES,
      files: config.MAX_FILES_PER_REQUEST,
      fields: 5,
      parts: config.MAX_FILES_PER_REQUEST + 5,
    },
  });

  const uploadLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many uploads, slow down' } },
  });

  // Busboy reports malformed multipart bodies as plain Errors; they're client errors.
  const parseUpload: RequestHandler = (req, res, next) => {
    upload.array('images', config.MAX_FILES_PER_REQUEST)(req, res, (err?: unknown) => {
      if (err && !(err instanceof multer.MulterError)) {
        return next(new HttpError(400, 'MALFORMED_MULTIPART', 'Could not parse the multipart upload'));
      }
      next(err);
    });
  };

  const parseId = (id: string | undefined): string => {
    if (!id || !UUID_RE.test(id)) throw notFound('Image');
    return id;
  };

  router.post('/', uploadLimiter, parseUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new HttpError(400, 'NO_FILES', 'Attach one or more files in the "images" field');
    const rows = await service.upload(files);
    res.status(202).json({ data: rows.map(toImageDto) });
  });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const page = await repo.list(query);
    res.json({ data: page.items.map(toImageDto), nextCursor: page.nextCursor });
  });

  router.get('/stats', async (_req, res) => {
    res.json({ data: await repo.countByStatus() });
  });

  router.get('/events', (_req, res) => {
    events.subscribe(res);
  });

  router.get('/:id', async (req, res) => {
    const row = await repo.findById(parseId(req.params.id));
    if (!row) throw notFound('Image');
    res.json({ data: toImageDto(row) });
  });

  // Stable URLs for <img src>: each hit redirects to a fresh short-lived signed URL,
  // so the bucket stays private and the client never holds an expired link.
  router.get('/:id/:variant', async (req, res) => {
    const variant = req.params.variant as keyof typeof VARIANTS;
    if (!Object.hasOwn(VARIANTS, variant)) throw notFound();
    const row = await repo.findById(parseId(req.params.id));
    const key = row?.[VARIANTS[variant]];
    if (!key) throw notFound('Image file');
    const cacheSeconds = Math.floor(config.SIGNED_URL_TTL_SECONDS / 2);
    res.set('Cache-Control', `private, max-age=${cacheSeconds}`).redirect(302, await storage.signedUrl(key));
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await service.delete(parseId(req.params.id));
    if (!deleted) throw notFound('Image');
    res.status(204).end();
  });

  return router;
}

import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Knex } from 'knex';
import { pinoHttp } from 'pino-http';
import type { Config } from '../config.js';
import type { EventHub } from '../images/eventHub.js';
import type { ImageRepository } from '../images/imageRepository.js';
import { imageRoutes } from '../images/imageRoutes.js';
import type { ImageService } from '../images/imageService.js';
import type { Logger } from '../logger.js';
import type { ObjectStorage } from '../storage/index.js';
import { errorHandler, notFound } from './errors.js';

export interface AppDeps {
  config: Config;
  db: Knex;
  repo: ImageRepository;
  service: ImageService;
  storage: ObjectStorage;
  events: EventHub;
  logger: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const { config, db, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/images/events' },
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', async (_req, res) => {
    await db.raw('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/images', imageRoutes(deps));

  if (config.STORAGE_DRIVER === 'local') {
    app.use(
      '/api/files',
      express.static(path.resolve(config.LOCAL_STORAGE_DIR), { dotfiles: 'deny', index: false, fallthrough: false }),
    );
  }

  app.use((_req, _res, next) => next(notFound('Route')));
  app.use(errorHandler(logger));
  return app;
}

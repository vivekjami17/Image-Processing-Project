import { loadConfig } from './config.js';
import { createDb } from './db/knex.js';
import { migrateLatest } from './db/migrate.js';
import { PgListener } from './db/pgListener.js';
import { createApp } from './http/app.js';
import { EventHub } from './images/eventHub.js';
import { toImageDto } from './images/imageDto.js';
import { CHANNELS, type ImageEvent, ImageRepository } from './images/imageRepository.js';
import { ImageService } from './images/imageService.js';
import { logger } from './logger.js';
import { thresholdsFrom } from './processing/thresholds.js';
import { createStorage } from './storage/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL, config.DB_POOL_MAX);
  const applied = await migrateLatest(db);
  if (applied.length) logger.info({ applied }, 'applied migrations');

  const storage = await createStorage(config);
  const repo = new ImageRepository(db);
  const service = new ImageService(repo, storage, thresholdsFrom(config), logger);
  const events = new EventHub(logger);

  // Workers announce status changes with NOTIFY; relay them to browsers.
  const listener = new PgListener(config.DATABASE_URL, [CHANNELS.events], logger);
  listener.on('notification', (_channel, payload) => void relay(payload));
  listener.on('reconnect', () => events.publish({ type: 'resync' }));
  await listener.start();

  async function relay(payload: string): Promise<void> {
    if (events.size === 0) return;
    try {
      const event = JSON.parse(payload) as ImageEvent;
      if (event.type === 'deleted') return events.publish({ type: 'image.deleted', id: event.id });
      const row = await repo.findById(event.id);
      if (row) events.publish({ type: 'image.updated', image: toImageDto(row) });
    } catch (err) {
      logger.error({ err, payload }, 'failed to relay image event');
    }
  }

  const app = createApp({ config, db, repo, service, storage, events, logger });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'api shutting down');
    events.close();
    server.close(() => {
      void Promise.all([listener.stop(), db.destroy()]).then(() => process.exit(0));
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
});

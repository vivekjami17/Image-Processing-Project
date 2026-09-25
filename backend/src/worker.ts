import { loadConfig } from './config.js';
import { createDb } from './db/knex.js';
import { PgListener } from './db/pgListener.js';
import { CHANNELS, ImageRepository } from './images/imageRepository.js';
import { logger } from './logger.js';
import { SsdFaceDetector } from './processing/faceDetector.js';
import { ImageProcessor } from './processing/imageProcessor.js';
import { thresholdsFrom } from './processing/thresholds.js';
import { JobRunner } from './queue/jobRunner.js';
import { createStorage } from './storage/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL, config.WORKER_CONCURRENCY + 2);
  const storage = await createStorage(config);
  const repo = new ImageRepository(db);

  const faceDetector = new SsdFaceDetector(config.FACE_MIN_CONFIDENCE);
  await faceDetector.warmUp();

  const processor = new ImageProcessor({
    storage,
    faceDetector,
    thresholds: thresholdsFrom(config),
    maxInputPixels: config.MAX_INPUT_PIXELS,
  });

  const runner = new JobRunner(
    repo,
    processor,
    storage,
    {
      concurrency: config.WORKER_CONCURRENCY,
      pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
      staleAfterSeconds: config.WORKER_STALE_AFTER_SECONDS,
      similarityMaxDistance: config.SIMILARITY_MAX_DISTANCE,
    },
    logger,
  );

  const listener = new PgListener(config.DATABASE_URL, [CHANNELS.jobs], logger);
  listener.on('notification', () => runner.wake());
  listener.on('reconnect', () => runner.wake());
  await listener.start();

  runner.start();
  logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await runner.stop();
    await listener.stop();
    await db.destroy();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});

import type { Knex } from 'knex';
import sharp from 'sharp';
import { ImageRepository, type ImageRow } from '../src/images/imageRepository.js';
import { ImageService } from '../src/images/imageService.js';
import { logger } from '../src/logger.js';
import { SsdFaceDetector } from '../src/processing/faceDetector.js';
import { ImageProcessor } from '../src/processing/imageProcessor.js';
import { thresholdsFrom } from '../src/processing/thresholds.js';
import { JobRunner } from '../src/queue/jobRunner.js';
import type { LocalStorage } from '../src/storage/index.js';
import { describeWithDb, fixture, resetDb, setupDb, syntheticJpeg, tempStorage, testConfig } from './helpers.js';

/**
 * End-to-end over the real pipeline: upload → queue → worker (real face detector,
 * real HEIC decoder) → final status. Only the storage is local instead of S3.
 */
describeWithDb('processing pipeline', () => {
  const config = testConfig();
  const log = logger.child({});
  log.level = 'silent';
  let db: Knex;
  let repo: ImageRepository;
  let service: ImageService;
  let storage: LocalStorage;
  let runner: JobRunner;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    db = await setupDb();
    ({ storage, cleanup } = await tempStorage());
    repo = new ImageRepository(db);
    service = new ImageService(repo, storage, thresholdsFrom(config), log);
    const faceDetector = new SsdFaceDetector(config.FACE_MIN_CONFIDENCE);
    await faceDetector.warmUp();
    const processor = new ImageProcessor({
      storage,
      faceDetector,
      thresholds: thresholdsFrom(config),
      maxInputPixels: config.MAX_INPUT_PIXELS,
    });
    runner = new JobRunner(
      repo,
      processor,
      storage,
      { concurrency: 2, pollIntervalMs: 50, maxAttempts: 3, staleAfterSeconds: 300, similarityMaxDistance: 8 },
      log,
    );
    runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await db.destroy();
    await cleanup();
  });

  beforeEach(() => resetDb(db));

  async function process(file: Buffer, name = 'upload.jpg'): Promise<ImageRow> {
    const [row] = await service.upload([{ originalname: name, buffer: file, size: file.length }]);
    runner.wake();
    for (let i = 0; i < 300; i++) {
      const current = await repo.findById(row!.id);
      if (current && current.status !== 'pending' && current.status !== 'processing') return current;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timed out waiting for processing');
  }

  const codes = (row: ImageRow) => row.rejection_reasons.map((r) => r.code);

  it('accepts a sharp photo of a single, reasonably sized face', async () => {
    const row = await process(await fixture('single-face.jpg'));
    expect(codes(row)).toEqual([]);
    expect(row).toMatchObject({ status: 'accepted', face_count: 1, width: 600, height: 600 });
    expect(row.processed_key).toBeTruthy();
    expect((await sharp(await storage.get(row.thumbnail_key!)).metadata()).format).toBe('webp');
  });

  it('converts HEIC to JPEG', async () => {
    const row = await process(await fixture('landscape.heic'), 'IMG_0001.HEIC');
    expect(row).toMatchObject({ status: 'accepted', format: 'heic', face_count: 0 });
    const processed = await sharp(await storage.get(row.processed_key!)).metadata();
    expect(processed).toMatchObject({ format: 'jpeg', width: 1280, height: 854 });
  });

  it('rejects multiple faces', async () => {
    const row = await process(await fixture('group.jpg'));
    expect(codes(row)).toEqual(['MULTIPLE_FACES']);
    expect(row.face_count).toBe(5);
  });

  it('rejects a face that is too small', async () => {
    const row = await process(await fixture('small-face.jpg'));
    expect(codes(row)).toEqual(['FACE_TOO_SMALL']);
  });

  it('rejects blurry images', async () => {
    const blurred = await sharp(await fixture('single-face.jpg')).blur(4).jpeg().toBuffer();
    expect(codes(await process(blurred))).toEqual(['BLURRY']);
  });

  it('rejects low resolution', async () => {
    const small = await syntheticJpeg(320, 240);
    expect(small.length).toBeGreaterThan(config.MIN_FILE_BYTES);
    expect(codes(await process(small))).toEqual(['RESOLUTION_TOO_LOW']);
  });

  it('rejects an image too similar to one already accepted', async () => {
    const original = await fixture('single-face.jpg');
    const first = await process(original);
    const copy = await sharp(original).resize(500).jpeg({ quality: 60 }).toBuffer();
    const second = await process(copy);
    expect(first.status).toBe('accepted');
    expect(codes(second)).toEqual(['TOO_SIMILAR']);
    expect(second.similar_to_id).toBe(first.id);
  });

  it('rejects a file that looks like a JPEG but is corrupt', async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20_000, 0x41)]);
    const row = await process(corrupt);
    expect(codes(row)).toEqual(['CORRUPT_IMAGE']);
    expect(row.thumbnail_key).toBeNull();
  });
});

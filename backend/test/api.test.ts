import type { Knex } from 'knex';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/http/app.js';
import { EventHub } from '../src/images/eventHub.js';
import { ImageRepository } from '../src/images/imageRepository.js';
import { ImageService } from '../src/images/imageService.js';
import { logger } from '../src/logger.js';
import { describeWithDb, fixture, resetDb, setupDb, syntheticJpeg, tempStorage, testConfig } from './helpers.js';

describeWithDb('images API', () => {
  let db: Knex;
  let app: Express;
  let events: EventHub;
  let storageDir: string;
  let cleanupStorage: () => Promise<void>;
  const log = logger.child({});
  log.level = 'silent';

  beforeAll(async () => {
    db = await setupDb();
    const { storage, dir, cleanup } = await tempStorage();
    storageDir = dir;
    cleanupStorage = cleanup;
    const config = testConfig({ LOCAL_STORAGE_DIR: dir, MAX_UPLOAD_BYTES: String(2 * 1024 * 1024) });
    const repo = new ImageRepository(db);
    const service = new ImageService(repo, storage, { minFileBytes: config.MIN_FILE_BYTES }, log);
    events = new EventHub(log);
    app = createApp({ config, db, repo, service, storage, events, logger: log });
  });

  afterAll(async () => {
    events.close();
    await db.destroy();
    await cleanupStorage();
  });

  beforeEach(() => resetDb(db));

  const upload = (...files: [Buffer, string][]) => {
    const req = request(app).post('/api/images');
    for (const [buf, name] of files) req.attach('images', buf, name);
    return req;
  };

  it('queues valid uploads as pending and stores the original', async () => {
    const res = await upload([await fixture('single-face.jpg'), 'me.jpg'], [await fixture('landscape.heic'), 'view.HEIC']);

    expect(res.status).toBe(202);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((i: { status: string }) => i.status)).toEqual(['pending', 'pending']);
    expect(res.body.data.map((i: { format: string }) => i.format)).toEqual(['jpeg', 'heic']);
    expect(res.body.data[0]).toMatchObject({
      originalFilename: 'me.jpg',
      urls: { original: expect.stringMatching(/^\/api\/images\/[0-9a-f-]+\/original$/), thumbnail: null },
    });
    const stored = await db('images').where({ status: 'pending' }).whereNotNull('original_key');
    expect(stored).toHaveLength(2);
  });

  it('rejects unsupported formats by content, whatever the file is called', async () => {
    const res = await upload([Buffer.from('GIF89a' + 'x'.repeat(20_000)), 'sneaky.jpg']);
    expect(res.status).toBe(202);
    expect(res.body.data[0]).toMatchObject({
      status: 'rejected',
      format: null,
      urls: { original: null },
      rejectionReasons: [{ code: 'UNSUPPORTED_FORMAT' }],
    });
  });

  it('rejects files below the minimum size without storing them', async () => {
    const tiny = await syntheticJpeg(16, 16);
    const res = await upload([tiny, 'tiny.jpg']);
    expect(res.body.data[0]).toMatchObject({ status: 'rejected', rejectionReasons: [{ code: 'FILE_TOO_SMALL' }] });
    expect(res.body.data[0].urls.original).toBeNull();
  });

  it('keeps only the base name of the uploaded filename', async () => {
    const res = await upload([await fixture('single-face.jpg'), '../../etc/passwd.jpg']);
    expect(res.body.data[0].originalFilename).toBe('passwd.jpg');
  });

  it('answers malformed multipart bodies with 400', async () => {
    const res = await upload([await fixture('single-face.jpg'), 'bell\u0007.jpg']);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_MULTIPART');
  });

  it('enforces the upload size limit', async () => {
    const res = await upload([Buffer.concat([await fixture('single-face.jpg'), Buffer.alloc(3 * 1024 * 1024)]), 'big.jpg']);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('LIMIT_FILE_SIZE');
  });

  it('requires at least one file', async () => {
    const res = await request(app).post('/api/images').field('x', 'y');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_FILES');
  });

  it('lists with status filter and keyset pagination', async () => {
    const photo = await fixture('single-face.jpg');
    for (let i = 0; i < 5; i++) await upload([photo, `p${i}.jpg`]);
    await upload([Buffer.from('not an image'.repeat(2000)), 'x.txt']);

    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await request(app)
        .get('/api/images')
        .query({ status: 'pending', limit: 2, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      all.push(...res.body.data.map((i: { originalFilename: string }) => i.originalFilename));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(all).toEqual(['p4.jpg', 'p3.jpg', 'p2.jpg', 'p1.jpg', 'p0.jpg']);

    const rejected = await request(app).get('/api/images').query({ status: 'rejected' });
    expect(rejected.body.data.map((i: { originalFilename: string }) => i.originalFilename)).toEqual(['x.txt']);

    const stats = await request(app).get('/api/images/stats');
    expect(stats.body.data).toMatchObject({ pending: 5, rejected: 1, accepted: 0 });
  });

  it('validates list parameters', async () => {
    expect((await request(app).get('/api/images').query({ status: 'bogus' })).status).toBe(400);
    expect((await request(app).get('/api/images').query({ limit: 1000 })).status).toBe(400);
    const badCursor = await request(app).get('/api/images').query({ cursor: 'garbage' });
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');
  });

  it('fetches, serves and deletes an image', async () => {
    const { body } = await upload([await fixture('single-face.jpg'), 'me.jpg']);
    const id: string = body.data[0].id;

    const got = await request(app).get(`/api/images/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.id).toBe(id);

    const file = await request(app).get(`/api/images/${id}/original`);
    expect(file.status).toBe(302);
    expect(file.headers.location).toBe(`/api/files/originals/${id}`);
    const served = await request(app).get(file.headers.location!);
    expect(served.status).toBe(200);

    expect((await request(app).get(`/api/images/${id}/thumbnail`)).status).toBe(404);
    expect((await request(app).get(`/api/images/${id}/secrets`)).status).toBe(404);

    expect((await request(app).delete(`/api/images/${id}`)).status).toBe(204);
    expect((await request(app).get(`/api/images/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/files/originals/${id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/images/${id}`)).status).toBe(404);
  });

  it('returns 404 for malformed ids rather than a database error', async () => {
    expect((await request(app).get('/api/images/not-a-uuid')).status).toBe(404);
  });

  it('does not serve files outside the storage root', async () => {
    const res = await request(app).get('/api/files/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(storageDir).toBeTruthy();
  });
});

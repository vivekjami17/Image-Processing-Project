import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import sharp from 'sharp';
import { loadConfig, type Config } from '../src/config.js';
import { createDb } from '../src/db/knex.js';
import { migrateLatest } from '../src/db/migrate.js';
import { LocalStorage } from '../src/storage/index.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** Integration suites need Postgres; they're skipped (not failed) when it isn't configured. */
export const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name: string) => readFile(path.join(fixturesDir, name));

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL ?? 'postgres://unused@localhost/unused',
    STORAGE_DRIVER: 'local',
    ...overrides,
  });
}

export async function setupDb(): Promise<Knex> {
  const db = createDb(TEST_DATABASE_URL!, 5);
  await migrateLatest(db);
  return db;
}

export async function resetDb(db: Knex): Promise<void> {
  await db.raw('TRUNCATE images');
}

export async function tempStorage(): Promise<{ storage: LocalStorage; dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-storage-'));
  return { storage: new LocalStorage(dir), dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A detailed, sharp, face-free JPEG of the requested size (random noise + shapes). */
export async function syntheticJpeg(width: number, height: number, seed = 1): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = s & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Knex } from 'knex';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createDb } from './knex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Same code runs from src/ (.ts, under tsx) and from dist/ (.js) after a build.
const extension = path.extname(fileURLToPath(import.meta.url));

/**
 * Knex records migrations by file name, extension included, so a database migrated
 * from src/ (.ts) would look "corrupt" to the built app (.js). Naming migrations
 * without the extension makes both views of the same migration identical.
 */
class MigrationSource implements Knex.MigrationSource<string> {
  constructor(private readonly dir: string) {}

  async getMigrations(): Promise<string[]> {
    const files = await readdir(this.dir);
    return files
      .filter((f) => f.endsWith(extension) && !f.endsWith('.d.ts'))
      .map((f) => f.slice(0, -extension.length))
      .sort();
  }

  getMigrationName(name: string): string {
    return name;
  }

  getMigration(name: string): Promise<Knex.Migration> {
    return import(pathToFileURL(path.join(this.dir, name + extension)).href) as Promise<Knex.Migration>;
  }
}

export async function migrateLatest(db: Knex): Promise<string[]> {
  const [, applied] = (await db.migrate.latest({
    migrationSource: new MigrationSource(path.join(here, 'migrations')),
  })) as [number, string[]];
  return applied;
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL, 1);
  migrateLatest(db)
    .then((applied) => logger.info({ applied }, 'migrations complete'))
    .catch((err: unknown) => {
      logger.error({ err }, 'migration failed');
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}

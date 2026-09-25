import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createDb } from './knex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Same code runs from src/ under tsx and from dist/ after a build.
const extension = path.extname(fileURLToPath(import.meta.url));

export function migrationConfig(): Knex.MigratorConfig {
  return { directory: path.join(here, 'migrations'), loadExtensions: [extension] };
}

export async function migrateLatest(db: Knex): Promise<string[]> {
  const [, applied] = (await db.migrate.latest(migrationConfig())) as [number, string[]];
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

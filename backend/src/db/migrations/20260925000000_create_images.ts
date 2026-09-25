import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await knex.raw(
    `CREATE TYPE image_status AS ENUM ('pending', 'processing', 'accepted', 'rejected', 'failed')`,
  );

  await knex.schema.createTable('images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('original_filename', 255).notNullable();
    // Format as detected from the file's magic bytes, never from the client's claims.
    t.string('format', 8).nullable();
    t.string('mime_type', 64).nullable();
    t.integer('size_bytes').notNullable();
    t.integer('width').nullable();
    t.integer('height').nullable();

    t.specificType('status', 'image_status').notNullable().defaultTo('pending');
    t.jsonb('rejection_reasons').notNullable().defaultTo('[]');

    // Metrics computed by the worker; kept so thresholds can be audited or re-tuned later.
    t.specificType('blur_score', 'real').nullable();
    t.smallint('face_count').nullable();
    t.specificType('face_height_ratio', 'real').nullable();
    // 64-bit difference hash, compared by Hamming distance for near-duplicate detection.
    t.bigInteger('phash').nullable();
    t.uuid('similar_to_id').nullable().references('id').inTable('images').onDelete('SET NULL');

    t.string('original_key', 255).nullable();
    t.string('processed_key', 255).nullable();
    t.string('thumbnail_key', 255).nullable();

    // Job bookkeeping: the images table doubles as the work queue.
    t.smallint('attempts').notNullable().defaultTo(0);
    t.timestamp('run_after', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('locked_at', { useTz: true }).nullable();
    t.text('last_error').nullable();

    // Millisecond precision so the value round-trips exactly through a JS Date,
    // which keyset-pagination cursors depend on.
    t.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('processed_at', { useTz: true }).nullable();
  });

  await knex.raw(`
    ALTER TABLE images
      ADD CONSTRAINT images_format_check CHECK (format IN ('jpeg', 'png', 'heic')),
      ADD CONSTRAINT images_size_check CHECK (size_bytes >= 0)
  `);

  // Keyset pagination, with and without a status filter.
  await knex.raw('CREATE INDEX images_created_idx ON images (created_at DESC, id DESC)');
  await knex.raw('CREATE INDEX images_status_created_idx ON images (status, created_at DESC, id DESC)');
  // Queue: workers only ever scan pending rows that are due.
  await knex.raw(`CREATE INDEX images_queue_idx ON images (run_after, created_at) WHERE status = 'pending'`);
  // Recovery of jobs abandoned by a crashed worker.
  await knex.raw(`CREATE INDEX images_stale_idx ON images (locked_at) WHERE status = 'processing'`);
  // Narrow covering index so the similarity scan is index-only over accepted images.
  await knex.raw(`
    CREATE INDEX images_phash_accepted_idx ON images (phash) INCLUDE (id)
    WHERE status = 'accepted' AND phash IS NOT NULL
  `);
  await knex.raw('CREATE INDEX images_similar_to_idx ON images (similar_to_id) WHERE similar_to_id IS NOT NULL');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('images');
  await knex.raw('DROP TYPE IF EXISTS image_status');
}

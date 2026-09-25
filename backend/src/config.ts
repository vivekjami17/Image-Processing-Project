import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_BUCKET: z.string().default('images'),
  S3_REGION: z.string().default('us-east-1'),
  // Custom endpoint for S3-compatible services (LocalStack, MinIO, R2). Leave unset for AWS.
  S3_ENDPOINT: z.string().url().optional(),
  // Endpoint the *browser* can reach, used only when signing download URLs.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_CREATE_BUCKET: bool.default(false),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Upload limits (enforced at the HTTP boundary, before anything touches storage).
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_FILES_PER_REQUEST: z.coerce.number().int().positive().default(10),
  // Decompression-bomb guard: refuse to decode anything larger than this.
  MAX_INPUT_PIXELS: z.coerce.number().int().positive().default(60_000_000),

  // Validation thresholds.
  MIN_FILE_BYTES: z.coerce.number().int().nonnegative().default(10 * 1024),
  MIN_WIDTH: z.coerce.number().int().positive().default(400),
  MIN_HEIGHT: z.coerce.number().int().positive().default(400),
  BLUR_THRESHOLD: z.coerce.number().positive().default(50),
  SIMILARITY_MAX_DISTANCE: z.coerce.number().int().min(0).max(64).default(8),
  FACE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  // Minimum face-box height as a fraction of the image height.
  FACE_MIN_HEIGHT_RATIO: z.coerce.number().min(0).max(1).default(0.15),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WORKER_STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

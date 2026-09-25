import type { Config } from '../config.js';
import { LocalStorage } from './localStorage.js';
import { S3Storage } from './s3Storage.js';
import type { ObjectStorage } from './storage.js';

export type { ObjectStorage } from './storage.js';
export { LocalStorage } from './localStorage.js';

export async function createStorage(config: Config): Promise<ObjectStorage> {
  if (config.STORAGE_DRIVER === 'local') return new LocalStorage(config.LOCAL_STORAGE_DIR);

  const storage = new S3Storage({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    signedUrlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
  });
  if (config.S3_CREATE_BUCKET) await storage.ensureBucket();
  return storage;
}

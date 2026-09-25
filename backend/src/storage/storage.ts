export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Minimal object-storage contract. The S3 implementation is used in every real
 * environment; the local implementation exists so the test-suite and quick local
 * runs don't need an S3 emulator.
 */
export interface ObjectStorage {
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(keys: string[]): Promise<void>;
  /** A short-lived URL the browser can GET the object from directly. */
  signedUrl(key: string): Promise<string>;
}

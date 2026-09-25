import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ObjectStorage, PutObjectInput } from './storage.js';

/**
 * Filesystem-backed storage for tests and S3-less local runs. Objects are served
 * back through the API's /files route, so `signedUrl` returns an app-relative path.
 */
export class LocalStorage implements ObjectStorage {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.rootDir, key);
    // Keys are generated server-side, but never trust a path join blindly.
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put({ key, body }: PutObjectInput): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(this.resolve(key), { force: true })));
  }

  async signedUrl(key: string): Promise<string> {
    return `/api/files/${key}`;
  }
}

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage, PutObjectInput } from './storage.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  publicEndpoint?: string | undefined;
  forcePathStyle: boolean;
  signedUrlTtlSeconds: number;
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  // Separate client for presigning so URLs point at a host the browser can reach
  // (e.g. localhost:4566 rather than the in-cluster "localstack:4566").
  private readonly signer: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    const base: S3ClientConfig = { region: options.region, forcePathStyle: options.forcePathStyle };
    this.client = new S3Client({ ...base, endpoint: options.endpoint });
    this.signer = new S3Client({ ...base, endpoint: options.publicEndpoint ?? options.endpoint });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    }
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: this.options.endpoint ? undefined : 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for object ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.options.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  signedUrl(key: string): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), {
      expiresIn: this.options.signedUrlTtlSeconds,
    });
  }
}

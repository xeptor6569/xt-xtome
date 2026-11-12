import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { Config } from "./config.js";

type PutBody = Buffer | Uint8Array | Readable;

export interface StoredObject {
  body: Readable | Uint8Array;
  contentType: string | undefined;
  contentLength: number | undefined;
  contentRange: string | undefined;
}

export interface ObjectStorage {
  bucket: string;
  ensureBucket(): Promise<void>;
  put(key: string, body: PutBody, contentType: string): Promise<void>;
  get(key: string, range?: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
}

export function createStorage(config: Config): ObjectStorage | null {
  if (!config.s3Endpoint || !config.s3AccessKey || !config.s3SecretKey) {
    return null;
  }
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3AccessKey,
      secretAccessKey: config.s3SecretKey,
    },
  });
  const bucket = config.s3Bucket;

  return {
    bucket,
    async ensureBucket(): Promise<void> {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },
    async put(key: string, body: PutBody, contentType: string): Promise<void> {
      const contentLength = Buffer.isBuffer(body) || body instanceof Uint8Array ? body.byteLength : undefined;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
      );
    },
    async get(key: string, range?: string): Promise<StoredObject> {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: range,
        }),
      );
      const body = result.Body;
      if (!body) {
        throw new Error("Stored file is empty.");
      }
      return {
        body: body as Readable,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        contentRange: result.ContentRange,
      };
    },
    async remove(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

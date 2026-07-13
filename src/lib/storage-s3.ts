/**
 * Concrete S3-compatible storage provider (AWS S3, Cloudflare R2, or any
 * S3-compatible endpoint). Implements the vendor-neutral StorageProvider from
 * src/lib/storage.ts using the modular AWS SDK v3 — no SchoolSync route ever
 * imports the SDK directly.
 *
 * Config: STORAGE_BUCKET, STORAGE_REGION are always required.
 * STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY are OPTIONAL and only for
 * environments without an ambient AWS identity (e.g. local development
 * against a real bucket, or an S3-compatible provider like R2 that has no
 * concept of IAM roles). When unset, no `credentials` object is passed to
 * the S3Client at all — the AWS SDK's default provider chain resolves
 * credentials itself, which on ECS Fargate means the task's IAM role via the
 * container credential provider (temporary, auto-rotating; never a
 * long-lived access key). See {@link resolveS3Credentials}.
 * STORAGE_ENDPOINT (R2/compatible), STORAGE_PUBLIC_BASE_URL (CDN/base for
 * PUBLIC objects) remain optional.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  StorageProvider,
  PutObjectInput,
  StoredObjectMeta,
  GetDownloadUrlOptions,
  StorageVisibility,
} from "@/lib/storage";

export type S3Credentials = { accessKeyId: string; secretAccessKey: string };

export type S3StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  /** Explicit static credentials. Undefined = use the AWS SDK default credential provider chain (ECS task role, etc). */
  credentials?: S3Credentials;
  publicBaseUrl?: string;
};

/**
 * Resolves explicit S3 credentials from the two access-key env vars, with a
 * strict all-or-nothing contract:
 *   - both set    -> explicit credentials (local dev against real S3, or an
 *                    S3-compatible provider with no IAM concept).
 *   - neither set -> `undefined`, so the caller omits `credentials` entirely
 *                    and the AWS SDK's default provider chain resolves them
 *                    (the ECS task role in staging).
 *   - exactly one set -> almost certainly a typo/partial config, not a
 *                    deliberate choice of either mode. Throws rather than
 *                    silently either passing a broken partial credentials
 *                    object to the SDK or silently falling back to the
 *                    default chain and masking the mistake.
 */
export function resolveS3Credentials(accessKeyId?: string, secretAccessKey?: string): S3Credentials | undefined {
  const hasAccessKeyId = Boolean(accessKeyId);
  const hasSecretAccessKey = Boolean(secretAccessKey);

  if (hasAccessKeyId && hasSecretAccessKey) {
    return { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
  }
  if (!hasAccessKeyId && !hasSecretAccessKey) {
    return undefined;
  }
  throw new Error(
    "STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must both be set (explicit credentials) or both be unset " +
      "(use the AWS SDK default credential provider chain, e.g. the ECS task role) — exactly one being set is treated as a misconfiguration."
  );
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // AWS SDK returns a web/Node stream depending on runtime; support both.
  const anyBody = body as { transformToByteArray?: () => Promise<Uint8Array> } & AsyncIterable<Uint8Array>;
  if (typeof anyBody?.transformToByteArray === "function") {
    return Buffer.from(await anyBody.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of anyBody) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl?: string;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl;
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
      // Omitted entirely (not `credentials: undefined`) when no explicit
      // pair is configured, so the AWS SDK's default provider chain runs —
      // on ECS this resolves to the task role via the container credential
      // provider automatically.
      ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
    });
  }

  async putObject(input: PutObjectInput): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: Buffer.from(input.body),
        ContentType: input.contentType,
        Metadata: { visibility: input.visibility, ...(input.metadata ?? {}) },
      })
    );
    return { key: input.key };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { body: await streamToBuffer(res.Body), contentType: res.ContentType ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async head(key: string): Promise<StoredObjectMeta | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const visibility = (res.Metadata?.visibility as StorageVisibility) ?? "TENANT_PRIVATE";
      return {
        key,
        contentType: res.ContentType ?? "application/octet-stream",
        size: Number(res.ContentLength ?? 0),
        visibility,
        metadata: res.Metadata,
      };
    } catch {
      return null;
    }
  }

  async getDownloadUrl(key: string, opts?: GetDownloadUrlOptions): Promise<string> {
    // Callers presign for private objects; PUBLIC objects are resolved via the
    // public base URL by the file service, not here.
    const expiresIn = Math.max(30, Math.min(opts?.expiresInSeconds ?? 300, 3600));
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts?.downloadFilename
          ? { ResponseContentDisposition: `inline; filename="${opts.downloadFilename.replace(/"/g, "")}"` }
          : {}),
      }),
      { expiresIn }
    );
  }

  publicUrl(key: string): string | null {
    return this.publicBaseUrl ? `${this.publicBaseUrl.replace(/\/$/, "")}/${key}` : null;
  }
}

export function s3ConfigFromEnv(): S3StorageConfig | null {
  const bucket = process.env.STORAGE_BUCKET;
  const region = process.env.STORAGE_REGION;
  if (!bucket || !region) return null;
  return {
    bucket,
    region,
    credentials: resolveS3Credentials(process.env.STORAGE_ACCESS_KEY_ID, process.env.STORAGE_SECRET_ACCESS_KEY),
    endpoint: process.env.STORAGE_ENDPOINT,
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL,
  };
}

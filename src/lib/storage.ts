/**
 * Centralized object-storage abstraction.
 *
 * Business routes depend on this interface, never on a provider SDK. Today the
 * repository has NO object-storage vendor configured and no vendor SDK installed,
 * so the concrete production adapter (S3 / Cloudflare R2 — both S3-compatible)
 * is a config-guarded slot: an S3-compatible implementation drops in here and is
 * selected via env, without touching any call site.
 *
 * Safety principle: in production we must NEVER silently persist real files to an
 * ephemeral serverless filesystem or a process-local Map. If no durable provider
 * is configured, upload/read operations fail with a clear configuration error
 * instead of pretending to store data.
 *
 * Required env for the production adapter (documented; not read here until an
 * S3-compatible adapter is wired):
 *   STORAGE_BUCKET, STORAGE_REGION, STORAGE_ENDPOINT (for R2/S3-compatible),
 *   STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_PUBLIC_BASE_URL.
 */

import { randomUUID } from "node:crypto";
import { S3StorageProvider, s3ConfigFromEnv } from "@/lib/storage-s3";

export type StorageVisibility =
  | "PUBLIC" // e.g. school logo / public branding asset
  | "TENANT_PRIVATE" // homework attachments, operational docs — any authenticated member of the tenant
  | "SCOPED_PRIVATE" // submissions, report cards, receipts — a specific guardian/student
  | "BILLING_PRIVATE"; // payment proofs — founder/billing only

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  visibility: StorageVisibility;
  /** Small, non-sensitive metadata only (never secrets/PII beyond ownership ids). */
  metadata?: Record<string, string>;
}

export interface StoredObjectMeta {
  key: string;
  contentType: string;
  size: number;
  visibility: StorageVisibility;
  metadata?: Record<string, string>;
}

export interface GetDownloadUrlOptions {
  /** Signed-URL expiry (seconds) for private objects. Ignored for PUBLIC. */
  expiresInSeconds?: number;
  downloadFilename?: string;
}

export interface StorageProvider {
  putObject(input: PutObjectInput): Promise<{ key: string }>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  deleteObject(key: string): Promise<void>;
  head(key: string): Promise<StoredObjectMeta | null>;
  /** Authenticated/signed access URL for a stored object. */
  getDownloadUrl(key: string, opts?: GetDownloadUrlOptions): Promise<string>;
}

// ── Tenant-safe storage keys ─────────────────────────────────────────────────

const KEY_SAFE = /[^a-zA-Z0-9._-]/g;

/** Sanitizes an original client filename down to a safe, bounded basename. */
export function safeFilename(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(KEY_SAFE, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}

/**
 * Generates a server-controlled, tenant-namespaced storage key. Clients never
 * supply keys — this prevents both path traversal and cross-tenant writes.
 *   {category}/{schoolId}/{yyyy}/{mm}/{uuid}-{safeName}
 */
export function generateStorageKey(params: {
  category: string;
  schoolId: string;
  originalFilename: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const category = params.category.replace(KEY_SAFE, "_").toLowerCase();
  const schoolId = params.schoolId.replace(KEY_SAFE, "_");
  return `${category}/${schoolId}/${yyyy}/${mm}/${randomUUID()}-${safeFilename(params.originalFilename)}`;
}

/** The tenant-namespace prefix a key MUST start with for a given school+category. */
export function tenantKeyPrefix(category: string, schoolId: string): string {
  return `${category.replace(KEY_SAFE, "_").toLowerCase()}/${schoolId.replace(KEY_SAFE, "_")}/`;
}

/**
 * Authorization guard for any operation on a caller-referenced key. Rejects path
 * traversal and any key that does not live under the caller's own tenant prefix.
 * Object-key possession is never treated as authorization on its own.
 */
export function assertKeyInTenantNamespace(key: string, category: string, schoolId: string): void {
  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    throw new StorageError("INVALID_KEY", "Invalid storage key");
  }
  if (!key.startsWith(tenantKeyPrefix(category, schoolId))) {
    throw new StorageError("CROSS_TENANT_KEY", "Storage key does not belong to this tenant");
  }
}

export class StorageError extends Error {
  constructor(
    public readonly code:
      | "NOT_CONFIGURED"
      | "INVALID_KEY"
      | "CROSS_TENANT_KEY"
      | "NOT_FOUND"
      | "PROVIDER_ERROR",
    message: string
  ) {
    super(message);
    this.name = "StorageError";
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

/** In-memory provider for tests and local development ONLY. Never for production. */
export class MemoryStorageProvider implements StorageProvider {
  private store = new Map<string, { body: Buffer; contentType: string; visibility: StorageVisibility; metadata?: Record<string, string> }>();

  async putObject(input: PutObjectInput) {
    this.store.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      visibility: input.visibility,
      metadata: input.metadata,
    });
    return { key: input.key };
  }
  async getObject(key: string) {
    const found = this.store.get(key);
    return found ? { body: found.body, contentType: found.contentType } : null;
  }
  async deleteObject(key: string) {
    this.store.delete(key);
  }
  async head(key: string): Promise<StoredObjectMeta | null> {
    const found = this.store.get(key);
    return found
      ? { key, contentType: found.contentType, size: found.body.byteLength, visibility: found.visibility, metadata: found.metadata }
      : null;
  }
  async getDownloadUrl(key: string) {
    return `memory://${key}`;
  }
  reset() {
    this.store.clear();
  }
}

/**
 * Provider used when production has no durable storage configured. Every mutating
 * or reading operation fails loudly with a configuration error, so we never
 * silently drop production uploads into an ephemeral filesystem.
 */
export class NotConfiguredStorageProvider implements StorageProvider {
  private fail(): never {
    throw new StorageError(
      "NOT_CONFIGURED",
      "Object storage is not configured. Set STORAGE_* environment variables to enable uploads."
    );
  }
  // Every method's signature intentionally matches the full StorageProvider
  // interface (so callers typed against the interface can pass real
  // arguments) even though the implementation never reads them — it always
  // fails before using them. `void` marks each parameter as a deliberate,
  // read-once reference rather than dead code.
  async putObject(input: PutObjectInput): Promise<{ key: string }> {
    void input;
    this.fail();
  }
  async getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    void key;
    this.fail();
  }
  async deleteObject(key: string): Promise<void> {
    void key;
    this.fail();
  }
  async head(key: string): Promise<StoredObjectMeta | null> {
    void key;
    this.fail();
  }
  async getDownloadUrl(key: string, opts?: GetDownloadUrlOptions): Promise<string> {
    void key;
    void opts;
    this.fail();
  }
}

/** True when a durable object-storage provider is fully configured via env. */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.STORAGE_BUCKET &&
      process.env.STORAGE_REGION &&
      process.env.STORAGE_ACCESS_KEY_ID &&
      process.env.STORAGE_SECRET_ACCESS_KEY
  );
}

/** Public URL for a PUBLIC object, or null when no public base is configured. */
export function storagePublicUrl(key: string): string | null {
  const base = process.env.STORAGE_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : null;
}

let providerOverride: StorageProvider | null = null;

/** Test/bootstrap hook to inject a provider (e.g. MemoryStorageProvider). */
export function setStorageProvider(provider: StorageProvider | null): void {
  providerOverride = provider;
}

/**
 * Resolves the active storage provider.
 *   - explicit override (tests/bootstrap) wins;
 *   - configured env → (future) S3-compatible adapter slots in here;
 *   - production without config → NotConfiguredStorageProvider (fails safe);
 *   - dev/test without config → MemoryStorageProvider.
 */
let cachedS3: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (providerOverride) return providerOverride;
  if (isStorageConfigured()) {
    if (!cachedS3) {
      const cfg = s3ConfigFromEnv();
      if (!cfg) return new NotConfiguredStorageProvider();
      cachedS3 = new S3StorageProvider(cfg);
    }
    return cachedS3;
  }
  if (process.env.NODE_ENV === "production") return new NotConfiguredStorageProvider();
  return new MemoryStorageProvider();
}

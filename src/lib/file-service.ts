/**
 * Business-level file service layered above StorageProvider. Routes call this,
 * never a provider SDK or the storage primitives directly. It validates content,
 * generates tenant-safe keys, uploads, and records durable StoredFile metadata
 * with compensating cleanup so a failed metadata write never leaves an orphan
 * object dangling.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, generateStorageKey, storagePublicUrl, safeFilename, StorageError } from "@/lib/storage";
import { validateUpload, type UploadCategory } from "@/lib/upload-validation";
import type { StoredFile, StoredFileCategory, FileUploaderActorType } from "@/generated/prisma/client";

export type UploaderRef = { type: FileUploaderActorType; id?: string | null };

export type UploadResult =
  | { ok: true; file: StoredFile }
  | { ok: false; status: number; error: string };

export async function uploadManagedFile(params: {
  category: UploadCategory;
  schoolId: string | null;
  originalFilename: string;
  declaredContentType?: string;
  bytes: Uint8Array;
  uploader: UploaderRef;
}): Promise<UploadResult> {
  const validation = validateUpload(params.category, {
    declaredContentType: params.declaredContentType,
    size: params.bytes.byteLength,
    bytes: params.bytes,
  });
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const key = generateStorageKey({
    category: params.category,
    schoolId: params.schoolId ?? "platform",
    originalFilename: params.originalFilename,
  });
  const checksum = createHash("sha256").update(Buffer.from(params.bytes)).digest("hex");

  let provider;
  try {
    provider = getStorageProvider();
  } catch (err) {
    if (err instanceof StorageError && err.code === "NOT_CONFIGURED") {
      return { ok: false, status: 503, error: "File storage is not configured" };
    }
    throw err;
  }

  // 1) Upload the object.
  try {
    await provider.putObject({
      key,
      body: Buffer.from(params.bytes),
      contentType: validation.contentType,
      visibility: validation.visibility,
      metadata: { schoolId: params.schoolId ?? "" },
    });
  } catch (err) {
    console.error("[file-service] object upload failed", { category: params.category });
    void err;
    return { ok: false, status: 502, error: "Failed to upload file" };
  }

  // 2) Record metadata; on failure, compensate by deleting the orphan object.
  try {
    const file = await prisma.storedFile.create({
      data: {
        schoolId: params.schoolId,
        storageKey: key,
        originalFilename: safeFilename(params.originalFilename),
        contentType: validation.contentType,
        sizeBytes: validation.size,
        checksum,
        category: params.category as StoredFileCategory,
        visibility: validation.visibility,
        uploaderType: params.uploader.type,
        uploaderId: params.uploader.id ?? null,
      },
    });
    return { ok: true, file };
  } catch (err) {
    console.error("[file-service] metadata create failed; attempting orphan cleanup", { key });
    void err;
    try {
      await provider.deleteObject(key);
    } catch {
      console.error("[file-service] orphan object cleanup FAILED — manual cleanup may be required", { key });
    }
    return { ok: false, status: 500, error: "Failed to store file" };
  }
}

/**
 * Stores server-generated JSON (e.g. a large student-import source) as a private
 * managed object + StoredFile row. This is NOT a user upload, so it bypasses the
 * user-facing upload-validation policies (the bytes are produced server-side from
 * an already-parsed request body, not from an untrusted binary file).
 */
export async function storeJsonSource(params: {
  category: "STUDENT_IMPORT_SOURCE";
  schoolId: string;
  json: unknown;
  uploader: UploaderRef;
}): Promise<UploadResult> {
  const body = Buffer.from(JSON.stringify(params.json), "utf8");
  const key = generateStorageKey({ category: params.category, schoolId: params.schoolId, originalFilename: "import.json" });
  const checksum = createHash("sha256").update(body).digest("hex");

  let provider;
  try {
    provider = getStorageProvider();
  } catch (err) {
    if (err instanceof StorageError && err.code === "NOT_CONFIGURED") {
      return { ok: false, status: 503, error: "File storage is not configured" };
    }
    throw err;
  }

  try {
    await provider.putObject({ key, body, contentType: "application/json", visibility: "TENANT_PRIVATE", metadata: { schoolId: params.schoolId } });
  } catch {
    return { ok: false, status: 502, error: "Failed to store import source" };
  }
  try {
    const file = await prisma.storedFile.create({
      data: {
        schoolId: params.schoolId,
        storageKey: key,
        originalFilename: "import.json",
        contentType: "application/json",
        sizeBytes: body.byteLength,
        checksum,
        category: "STUDENT_IMPORT_SOURCE",
        visibility: "TENANT_PRIVATE",
        uploaderType: params.uploader.type,
        uploaderId: params.uploader.id ?? null,
      },
    });
    return { ok: true, file };
  } catch {
    try { await provider.deleteObject(key); } catch { /* logged below */ }
    console.error("[file-service] import-source metadata create failed", { key });
    return { ok: false, status: 500, error: "Failed to store import source" };
  }
}

/**
 * Extracts bytes/filename/declared content-type from a multipart form field.
 * Returns null when the field is missing or is not a file part.
 */
export async function readUploadedFile(
  req: Request,
  fieldName = "file"
): Promise<{ bytes: Uint8Array; filename: string; declaredContentType: string } | null> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return null;
  }
  const entry = form.get(fieldName);
  if (!(entry instanceof File)) return null;
  const bytes = new Uint8Array(await entry.arrayBuffer());
  return { bytes, filename: entry.name || "file", declaredContentType: entry.type || "" };
}

/** Reads a managed file's bytes (used by the PDF renderer to embed assets). */
export async function readManagedFileBytes(file: Pick<StoredFile, "storageKey">): Promise<Buffer | null> {
  const obj = await getStorageProvider().getObject(file.storageKey);
  return obj?.body ?? null;
}

/**
 * Resolves an access URL for a file. PUBLIC objects use the configured public
 * base URL; everything else returns a short-lived signed URL. Never returns a
 * permanent private object URL.
 */
export async function resolveDownloadUrl(
  file: Pick<StoredFile, "storageKey" | "visibility" | "originalFilename">,
  opts?: { expiresInSeconds?: number }
): Promise<string> {
  if (file.visibility === "PUBLIC") {
    const pub = storagePublicUrl(file.storageKey);
    if (pub) return pub;
  }
  return getStorageProvider().getDownloadUrl(file.storageKey, {
    expiresInSeconds: opts?.expiresInSeconds ?? 300,
    downloadFilename: file.originalFilename,
  });
}

/**
 * Resolves the URL to show for an entity that may have EITHER a managed file
 * id (preferred) or only a legacy URL string column. Managed files always
 * win — new uploads never populate the legacy column (see the upload routes),
 * so its presence means the row predates managed storage.
 */
export async function resolveManagedOrLegacyFileUrl(
  legacyUrl: string | null | undefined,
  managedFileId: string | null | undefined
): Promise<string | null> {
  if (managedFileId) {
    const file = await prisma.storedFile.findUnique({ where: { id: managedFileId } });
    if (file) return resolveDownloadUrl(file);
  }
  return legacyUrl ?? null;
}

/** Convenience wrapper for entities using the `attachmentUrl`/`attachmentFileId` naming. */
export async function resolveManagedOrLegacyUrl(entity: {
  attachmentUrl?: string | null;
  attachmentFileId?: string | null;
}): Promise<string | null> {
  return resolveManagedOrLegacyFileUrl(entity.attachmentUrl, entity.attachmentFileId);
}

/** Deletes a managed file (object first, then metadata). Best-effort on object. */
export async function deleteManagedFile(file: Pick<StoredFile, "id" | "storageKey">): Promise<void> {
  try {
    await getStorageProvider().deleteObject(file.storageKey);
  } catch {
    console.error("[file-service] object delete failed; removing metadata anyway", { key: file.storageKey });
  }
  await prisma.storedFile.delete({ where: { id: file.id } });
}

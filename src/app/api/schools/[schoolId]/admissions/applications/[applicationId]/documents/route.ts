import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead, requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { serializeDocument } from "@/lib/admissions/serializers";
import { generateStorageKey, getStorageProvider, safeFilename } from "@/lib/storage";
import { readUploadedFile } from "@/lib/file-service";
import { ADMISSION_DOCUMENT_LIMITS } from "@/lib/admissions/validation";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const documents = await prisma.admissionDocument.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(documents.map(serializeDocument));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionReviewWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }
  {
    const limited = await rateLimit(`admissions:doc-upload:${schoolId}:${access.actor.userId}`, RATE_LIMIT_POLICIES.uploadGlobal);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
    }
  }

  const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const upload = await readUploadedFile(req);
  if (!upload) return NextResponse.json({ error: "A file is required" }, { status: 400 });

  if (upload.bytes.byteLength > ADMISSION_DOCUMENT_LIMITS.maxBytes) {
    return NextResponse.json({ error: `File exceeds the ${ADMISSION_DOCUMENT_LIMITS.maxBytes / (1024 * 1024)}MB limit` }, { status: 400 });
  }
  if (!ADMISSION_DOCUMENT_LIMITS.allowedMimeTypes.has(upload.declaredContentType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  const documentType = typeof form?.get("documentType") === "string" ? String(form.get("documentType")).trim() : "";
  if (!documentType) return NextResponse.json({ error: "documentType is required" }, { status: 400 });

  const key = generateStorageKey({ category: "admission_document", schoolId, originalFilename: upload.filename });
  await getStorageProvider().putObject({
    key,
    body: Buffer.from(upload.bytes),
    contentType: upload.declaredContentType,
    visibility: "TENANT_PRIVATE",
    metadata: { applicationId, schoolId },
  });

  const document = await prisma.admissionDocument.create({
    data: {
      applicationId,
      schoolId,
      documentType,
      storageKey: key,
      originalFilename: safeFilename(upload.filename),
      mimeType: upload.declaredContentType,
      size: upload.bytes.byteLength,
      uploadedById: access.actor.userId,
    },
  });

  await logAudit({
    action: "ADMISSION_DOCUMENT_UPLOADED",
    entityType: "AdmissionDocument",
    entityId: document.id,
    metadata: { applicationId, documentType },
    userId: access.actor.userId,
    schoolId,
    actorRole: sessionRole(session.user),
    ipAddress: getClientIp(req),
  });

  return NextResponse.json(serializeDocument(document), { status: 201 });
}

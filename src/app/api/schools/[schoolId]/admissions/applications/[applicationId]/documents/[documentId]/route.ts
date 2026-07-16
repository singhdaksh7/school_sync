import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead, requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { admissionDocumentVerifySchema } from "@/lib/admissions/validation";
import { serializeDocument } from "@/lib/admissions/serializers";
import { getStorageProvider } from "@/lib/storage";

type Params = { schoolId: string; applicationId: string; documentId: string };

/**
 * Authenticated/authorized download route — streams the file body directly.
 * The raw storage key is NEVER returned in a JSON response anywhere in this
 * module; this route is the only way to read document bytes.
 */
export async function GET(_req: Request, { params }: { params: Promise<Params> }) {
  const { schoolId, applicationId, documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const document = await prisma.admissionDocument.findFirst({ where: { id: documentId, applicationId, schoolId } });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const object = await getStorageProvider().getObject(document.storageKey);
  if (!object) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      "Content-Disposition": `attachment; filename="${document.originalFilename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<Params> }) {
  const { schoolId, applicationId, documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionReviewWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = admissionDocumentVerifySchema.parse(await req.json());
    const existing = await prisma.admissionDocument.findFirst({ where: { id: documentId, applicationId, schoolId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const document = await prisma.admissionDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: data.verificationStatus,
        reviewReason: data.reviewReason ?? null,
        verifiedById: access.actor.userId,
        verifiedAt: new Date(),
      },
    });

    await logAudit({
      action: "ADMISSION_DOCUMENT_VERIFIED",
      entityType: "AdmissionDocument",
      entityId: documentId,
      metadata: { applicationId, verificationStatus: data.verificationStatus },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeDocument(document));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

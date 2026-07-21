import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead, requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { admissionNoteCreateSchema } from "@/lib/admissions/validation";
import { serializeNote } from "@/lib/admissions/serializers";

// Every current reader of this endpoint (SCHOOL_OWNER/SCHOOL_ADMIN/
// VICE_PRINCIPAL) is staff, so INTERNAL notes are safe to include here.
// There is no applicant-facing surface yet (v1 is staff-only — see PR
// description); if/when one is built it MUST call a route that filters to
// type === 'APPLICANT_VISIBLE' only, never this one.
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

  const notes = await prisma.admissionNote.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(notes.map(serializeNote));
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

  try {
    const data = admissionNoteCreateSchema.parse(await req.json());
    const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const note = await prisma.admissionNote.create({
      data: { applicationId, schoolId, type: data.type, body: data.body, authorId: access.actor.userId },
    });

    await logAudit({
      action: "ADMISSION_NOTE_CREATED",
      entityType: "AdmissionNote",
      entityId: note.id,
      metadata: { applicationId, type: data.type },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeNote(note), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";
import { serializeTemplate } from "@/lib/report-card-templates";
import { enforceUploadQuota } from "@/lib/api-cost-guard";

const ASSET_KIND_FIELD: Record<string, "logoFileId" | "stampFileId" | "principalSignatureFileId"> = {
  logo: "logoFileId",
  stamp: "stampFileId",
  signature: "principalSignatureFileId",
};

// Managed uploads for report-card template branding assets (logo/stamp/
// signature). Replacement never mutates or deletes the previous StoredFile —
// a report card generated before the replacement still resolves its own
// immutable asset copy via ReportCard.templateSnapshot (see report-cards.ts).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; templateId: string }> }
) {
  const { schoolId, templateId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const denied = await enforceUploadQuota({ schoolId, actorType: sessionRole(session.user) ?? "USER", actorId: session.user.id }, "REPORT_CARD_ASSET");
  if (denied) return denied;

  const template = await prisma.reportCardTemplate.findFirst({ where: { id: templateId, schoolId } });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "An asset file is required" }, { status: 400 });
  }
  const kind = typeof form.get("kind") === "string" ? (form.get("kind") as string) : "";
  const field = ASSET_KIND_FIELD[kind];
  if (!field) return NextResponse.json({ error: "kind must be one of: logo, stamp, signature" }, { status: 400 });

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) return NextResponse.json({ error: "An asset file is required" }, { status: 400 });
  const bytes = new Uint8Array(await fileEntry.arrayBuffer());

  const result = await uploadManagedFile({
    category: "REPORT_CARD_ASSET",
    schoolId,
    originalFilename: fileEntry.name || "file",
    declaredContentType: fileEntry.type || "",
    bytes,
    uploader: { type: "USER", id: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const updated = await prisma.reportCardTemplate.update({
    where: { id: templateId },
    data: { [field]: result.file.id },
  });

  const url = await resolveDownloadUrl(result.file);
  return NextResponse.json(
    { template: await serializeTemplate(updated), file: { id: result.file.id, url, kind } },
    { status: 201 }
  );
}

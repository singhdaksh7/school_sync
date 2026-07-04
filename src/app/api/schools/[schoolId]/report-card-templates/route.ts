import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { buildTemplateData, serializeTemplate } from "@/lib/report-card-templates";

// Validate that every assigned class id actually belongs to this school.
async function classesBelongToSchool(classIds: string[], schoolId: string) {
  const ids = [...new Set(classIds)];
  if (ids.length === 0) return true;
  const count = await prisma.class.count({ where: { id: { in: ids }, schoolId } });
  return count === ids.length;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const templates = await prisma.reportCardTemplate.findMany({
    where: { schoolId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({ templates: await Promise.all(templates.map(serializeTemplate)) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = buildTemplateData(body, false);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data } = result;
  if (!(await classesBelongToSchool(data.assignedClassIds, schoolId))) {
    return NextResponse.json({ error: "One or more classes do not belong to this school" }, { status: 400 });
  }

  const makeDefault = body.isDefault === true;
  // name is guaranteed present here (buildTemplateData errors otherwise).
  const name = data.name ?? "Untitled Template";

  const template = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.reportCardTemplate.updateMany({ where: { schoolId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.reportCardTemplate.create({
      data: { ...data, name, schoolId, isDefault: makeDefault },
    });
  });

  return NextResponse.json({ template: await serializeTemplate(template) }, { status: 201 });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, classBelongsToSchool, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { createDraft, listDrafts } from "@/lib/smart-timetable-drafts";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId") ?? undefined;
  const classId = searchParams.get("classId") ?? undefined;
  const page = parsePagination(searchParams, { defaultLimit: 25, maxLimit: 100 });

  const [drafts, total] = await listDrafts(schoolId, { sectionId, classId, skip: page.skip, take: page.take });
  return NextResponse.json({ data: drafts, pagination: buildPaginationMeta(total, page.page, page.limit) });
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { classId, sectionId } = await req.json();
  if (!classId || !sectionId) return NextResponse.json({ error: "classId and sectionId are required" }, { status: 400 });
  if (!(await classBelongsToSchool(classId, schoolId)) || !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Class or section not found in this school" }, { status: 400 });
  }

  const draft = await createDraft({ schoolId, classId, sectionId, createdById: session.user.id, source: "MANUAL" });
  return NextResponse.json({ draft }, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { parsePagination } from "@/lib/pagination";
import {
  announcementInputSchema,
  createAnnouncement,
  listAnnouncementsForTeacher,
  getTeacherAuthorizedSections,
  AnnouncementAuthError,
} from "@/lib/announcements";

/** Teacher's own class/section-targeted announcements + school-wide TEACHERS-audience announcements. Never school-wide creation — see createAnnouncement's teacher branch. */
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("authorizedSections") === "1") {
    const sections = await getTeacherAuthorizedSections(teacherAuth.teacherId, teacherAuth.schoolId);
    return NextResponse.json({ sections });
  }

  const pagination = parsePagination(searchParams);
  const result = await listAnnouncementsForTeacher(teacherAuth.schoolId, teacherAuth.teacherId, teacherAuth.userId, pagination);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data = announcementInputSchema.parse(body);
    const announcement = await createAnnouncement(
      { actorKind: "TEACHER", userId: teacherAuth.userId, teacherId: teacherAuth.teacherId, schoolId: teacherAuth.schoolId },
      data
    );
    return NextResponse.json(announcement, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Create teacher announcement error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

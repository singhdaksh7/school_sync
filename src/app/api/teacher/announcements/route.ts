import { NextResponse } from "next/server";
import { z } from "zod";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { parsePagination } from "@/lib/pagination";
import {
  announcementInputSchema,
  createAnnouncement,
  listAnnouncementsForTeacher,
  listAnnouncementsManagedByTeacher,
  getTeacherAuthorizedSections,
  AnnouncementAuthError,
} from "@/lib/announcements";

/**
 * Teacher's own class/section-targeted announcements + school-wide
 * TEACHERS-audience announcements (recipient feed), or — with `?mine=1` —
 * the announcements this teacher can MANAGE (their own, any status). Never
 * school-wide creation — see createAnnouncement's teacher branch.
 *
 * Gated by the standard ANNOUNCEMENTS module permission (same
 * requireTeacherPermission mechanism as HOMEWORK/ATTENDANCE/etc.) — a
 * teacher with no custom role assignment keeps legacy unrestricted access;
 * once a role is assigned, ANNOUNCEMENTS:VIEW/CREATE must be explicitly
 * granted. This is layered ON TOP of, never instead of, the class/section
 * teaching-authority check below — permission alone never expands which
 * sections a teacher can target (see createAnnouncement's teacher branch and
 * the per-target check in POST).
 */
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("authorizedSections") === "1") {
    const denied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "CREATE");
    if (denied) return denied;
    const sections = await getTeacherAuthorizedSections(teacherAuth.teacherId, teacherAuth.schoolId);
    return NextResponse.json({ sections });
  }

  const denied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "VIEW");
  if (denied) return denied;

  const pagination = parsePagination(searchParams);
  if (searchParams.get("mine") === "1") {
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const result = await listAnnouncementsManagedByTeacher(teacherAuth.schoolId, teacherAuth.userId, pagination, { status, search });
    return NextResponse.json(result);
  }

  const result = await listAnnouncementsForTeacher(teacherAuth.schoolId, teacherAuth.teacherId, teacherAuth.userId, pagination);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data = announcementInputSchema.parse(body);

    // Permission gate first (module-level: does this teacher have
    // ANNOUNCEMENTS:CREATE at all), then one class-authority check per
    // requested target (RBAC-scope narrowing, when the teacher's custom role
    // restricts them to specific classes/sections) — a granted CREATE
    // permission never expands access beyond a teacher's own configured
    // scope, and createAnnouncement below still independently re-derives
    // and enforces actual timetable/mentor teaching authority regardless of
    // any RBAC role at all.
    const targetsToCheck = data.targets.length > 0 ? data.targets : [undefined];
    for (const target of targetsToCheck) {
      const denied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "CREATE", target);
      if (denied) return denied;
    }

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

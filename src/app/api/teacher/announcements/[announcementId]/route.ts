import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import {
  announcementInputSchema,
  correctionSchema,
  updateDraftOrScheduled,
  publishAnnouncement,
  cancelAnnouncement,
  archiveAnnouncement,
  correctPublishedAnnouncement,
  getAnnouncementStats,
  AnnouncementAuthError,
} from "@/lib/announcements";

export async function GET(req: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "VIEW");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  if (searchParams.get("stats") === "1") {
    try {
      const stats = await getAnnouncementStats(teacherAuth.schoolId, announcementId);
      return NextResponse.json({ stats });
    } catch (err) {
      if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }

  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId: teacherAuth.schoolId },
    include: { audience: true, targets: { include: { class: { select: { name: true } }, section: { select: { name: true } } } } },
  });
  if (!announcement) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(announcement);
}

const actionSchema = z.object({ action: z.enum(["publish", "cancel", "archive", "correct"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // One EDIT-permission gate for the whole route — same per-route-file
  // granularity HOMEWORK's PATCH route uses (publish/cancel/archive/correct/
  // edit are all "manage this announcement" actions, not separate
  // sub-permissions; ANNOUNCEMENTS:MANAGE also satisfies this via
  // IMPLIED_BY in teacher-permissions.ts).
  const denied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "EDIT");
  if (denied) return denied;

  try {
    const body = await req.json();
    const ctx = { actorKind: "TEACHER" as const, userId: teacherAuth.userId, teacherId: teacherAuth.teacherId, schoolId: teacherAuth.schoolId };

    if (typeof body.action === "string") {
      const { action } = actionSchema.parse(body);
      if (action === "publish") return NextResponse.json(await publishAnnouncement(ctx, announcementId));
      if (action === "cancel") return NextResponse.json(await cancelAnnouncement(ctx, announcementId));
      if (action === "archive") return NextResponse.json(await archiveAnnouncement(ctx, announcementId));
      if (action === "correct") {
        const correction = correctionSchema.parse(body);
        return NextResponse.json(await correctPublishedAnnouncement(ctx, announcementId, correction));
      }
    }

    const data = announcementInputSchema.parse(body);
    // Same per-target RBAC-scope narrowing as POST create — permission
    // alone never expands which sections an edit can (re)target.
    const targetsToCheck = data.targets.length > 0 ? data.targets : [undefined];
    for (const target of targetsToCheck) {
      const targetDenied = await requireTeacherPermission(teacherAuth.teacherId, teacherAuth.schoolId, "ANNOUNCEMENTS", "EDIT", target);
      if (targetDenied) return targetDenied;
    }
    return NextResponse.json(await updateDraftOrScheduled(ctx, announcementId, data));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Update teacher announcement error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

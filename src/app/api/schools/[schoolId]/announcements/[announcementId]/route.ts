import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canAccessSchool } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  announcementInputSchema,
  correctionSchema,
  updateDraftOrScheduled,
  publishAnnouncement,
  cancelAnnouncement,
  archiveAnnouncement,
  correctPublishedAnnouncement,
  getAnnouncementStats,
  isLeadershipRole,
  AnnouncementAuthError,
} from "@/lib/announcements";

async function requireLeadership(schoolId: string, userId: string, role: string | undefined) {
  if (!isLeadershipRole(role)) return null;
  if (!(await canAccessSchool(schoolId, userId))) return null;
  return role;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; announcementId: string }> }) {
  const { schoolId, announcementId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await requireLeadership(schoolId, session.user.id, sessionRole(session.user));
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("stats") === "1") {
    try {
      const stats = await getAnnouncementStats(schoolId, announcementId);
      return NextResponse.json({ stats });
    } catch (err) {
      if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }

  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId },
    include: { createdBy: { select: { name: true, role: true } }, audience: true, targets: { include: { class: { select: { name: true } }, section: { select: { name: true } } } } },
  });
  if (!announcement) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(announcement);
}

const actionSchema = z.object({ action: z.enum(["publish", "cancel", "archive", "correct"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; announcementId: string }> }) {
  const { schoolId, announcementId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await requireLeadership(schoolId, session.user.id, sessionRole(session.user));
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const ctx = { actorKind: "LEADERSHIP" as const, userId: session.user.id, role, schoolId };

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
    return NextResponse.json(await updateDraftOrScheduled(ctx, announcementId, data));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Update announcement error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Retained for DRAFT cleanup only — published/scheduled announcements must go through cancel/archive so their history is preserved. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; announcementId: string }> }
) {
  const { schoolId, announcementId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await requireLeadership(schoolId, session.user.id, sessionRole(session.user));
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const announcement = await prisma.announcement.findFirst({ where: { id: announcementId, schoolId }, select: { title: true, status: true, createdById: true } });
  if (!announcement) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (announcement.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft announcements can be deleted — cancel or archive a published/scheduled announcement instead" }, { status: 409 });
  }

  await prisma.announcement.deleteMany({ where: { id: announcementId, schoolId } });
  await logAudit({
    action: "ANNOUNCEMENT_DELETED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { title: announcement.title },
    userId: session.user.id,
    schoolId,
    actorRole: role,
  });
  return NextResponse.json({ success: true });
}

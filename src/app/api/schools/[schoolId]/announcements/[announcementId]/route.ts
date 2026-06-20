import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; announcementId: string }> }
) {
  const { schoolId, announcementId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "ANNOUNCEMENTS", "DELETE");
  if (!access.ok) return access.response;

  const announcement = await prisma.announcement.findFirst({ where: { id: announcementId, schoolId }, select: { title: true } });
  await prisma.announcement.deleteMany({ where: { id: announcementId, schoolId } });
  if (announcement) {
    await logAudit({
      action: "ANNOUNCEMENT_DELETED",
      entityType: "Announcement",
      entityId: announcementId,
      metadata: { title: announcement.title },
      userId: session.user.id,
      schoolId,
    });
  }
  return NextResponse.json({ success: true });
}

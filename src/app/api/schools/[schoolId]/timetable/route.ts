import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canView(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

async function canWrite(schoolId: string, userId: string, role: string) {
  if (role === "VICE_PRINCIPAL") return false;
  return canView(schoolId, userId);
}

// GET: return school's periodsPerDay + all slots for a section
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canView(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");

  // Conflict check: ?checkConflict=true&teacherId=X&dayOfWeek=1&period=2&sectionId=Y
  const checkConflict = searchParams.get("checkConflict") === "true";
  if (checkConflict) {
    const teacherId = searchParams.get("teacherId");
    const dayOfWeek = parseInt(searchParams.get("dayOfWeek") || "0", 10);
    const period = parseInt(searchParams.get("period") || "0", 10);
    const excludeSectionId = searchParams.get("sectionId");
    if (teacherId && dayOfWeek && period) {
      const conflict = await prisma.timetableSlot.findFirst({
        where: {
          teacherId,
          dayOfWeek,
          period,
          ...(excludeSectionId ? { NOT: { sectionId: excludeSectionId } } : {}),
        },
        include: {
          section: { include: { class: { select: { name: true } } } },
        },
      });
      if (conflict) {
        return NextResponse.json({
          conflict: true,
          sectionName: conflict.section.name,
          className: conflict.section.class.name,
          subject: conflict.subject,
        });
      }
      return NextResponse.json({ conflict: false });
    }
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { periodsPerDay: true } });

  // allSlots=true: return all teacher assignments across all sections (for free-period display)
  if (searchParams.get("allSlots") === "true") {
    const all = await prisma.timetableSlot.findMany({
      where: { schoolId },
      select: { teacherId: true, dayOfWeek: true, period: true },
    });
    return NextResponse.json({ slots: all, periodsPerDay: school?.periodsPerDay ?? 6 });
  }

  const slots = sectionId
    ? await prisma.timetableSlot.findMany({
        where: { schoolId, sectionId },
        include: { teacher: { select: { id: true, name: true, subject: true } } },
      })
    : [];

  return NextResponse.json({ periodsPerDay: school?.periodsPerDay ?? 6, slots });
}

// PUT: upsert a single slot OR update periodsPerDay
export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role as string;
  if (!(await canWrite(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();

    // Update periodsPerDay
    if (typeof body.periodsPerDay === "number") {
      const updated = await prisma.school.update({
        where: { id: schoolId },
        data: { periodsPerDay: Math.max(1, Math.min(12, body.periodsPerDay)) },
        select: { periodsPerDay: true },
      });
      return NextResponse.json(updated);
    }

    // Upsert a slot
    const { sectionId, dayOfWeek, period, teacherId, subject } = body;
    if (!sectionId || !dayOfWeek || !period) {
      return NextResponse.json({ error: "sectionId, dayOfWeek, and period are required" }, { status: 400 });
    }

    // Clear slot
    if (!teacherId) {
      await prisma.timetableSlot.deleteMany({ where: { sectionId, dayOfWeek, period } });
      return NextResponse.json({ success: true });
    }

    const slot = await prisma.timetableSlot.upsert({
      where: { sectionId_dayOfWeek_period: { sectionId, dayOfWeek, period } },
      create: { schoolId, sectionId, dayOfWeek, period, teacherId, subject: subject || null },
      update: { teacherId, subject: subject || null },
      include: { teacher: { select: { id: true, name: true, subject: true } } },
    });
    return NextResponse.json(slot);
  } catch (err) {
    console.error("Timetable PUT error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

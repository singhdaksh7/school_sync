import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function verify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let teachers: any[];
  try {
    const body = await req.json();
    teachers = body.teachers;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return NextResponse.json({ error: "No teachers provided" }, { status: 400 });
  }

  const results: { name: string; success: boolean; inviteToken?: string; error?: string }[] = [];

  for (const row of teachers) {
    const name = String(row.name || "").trim();
    if (!name || name.length < 2) {
      results.push({ name: name || "(empty)", success: false, error: "Name too short" });
      continue;
    }
    try {
      const teacher = await prisma.teacher.create({
        data: {
          name,
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          subject: row.subject?.trim() || null,
          schoolId,
        },
      });

      let inviteToken: string | undefined;
      if (row.email?.trim()) {
        const invite = await prisma.teacherInvite.create({
          data: {
            email: row.email.trim(),
            teacherId: teacher.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        inviteToken = invite.token;
      }

      results.push({ name, success: true, inviteToken });
    } catch (err) {
      console.error("Bulk create teacher error:", err);
      results.push({ name, success: false, error: "Failed to create (duplicate or invalid data)" });
    }
  }

  return NextResponse.json({ results });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canWrite(schoolId: string, userId: string, role: string) {
  if (role === "VICE_PRINCIPAL") return false;
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
  const role = (session.user as any).role as string;
  if (!(await canWrite(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { students } = await req.json();
  if (!Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: "No students provided" }, { status: 400 });
  }

  // Build a map of class name -> section name -> section id for this school
  const classes = await prisma.class.findMany({
    where: { schoolId },
    include: { sections: { select: { id: true, name: true } } },
  });
  const sectionMap: Record<string, string> = {};
  for (const cls of classes) {
    for (const sec of cls.sections) {
      const key = `${cls.name.toLowerCase()}|${sec.name.toLowerCase()}`;
      sectionMap[key] = sec.id;
    }
  }

  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const row of students) {
    const name = String(row.name || "").trim();
    const rollNo = String(row.rollno || row.roll_no || row.roll || "").trim();
    const className = String(row.class || row.classname || "").trim().toLowerCase();
    const sectionName = String(row.section || "").trim().toLowerCase();

    if (!name || name.length < 2) {
      results.push({ name: name || "(empty)", success: false, error: "Name too short" });
      continue;
    }
    if (!rollNo) {
      results.push({ name, success: false, error: "Roll number missing" });
      continue;
    }

    const sectionId = sectionMap[`${className}|${sectionName}`];
    if (!sectionId) {
      results.push({ name, success: false, error: `Section not found: Class "${row.class}" Section "${row.section}"` });
      continue;
    }

    try {
      await prisma.student.create({
        data: {
          name,
          rollNo,
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          parentName: row.parentname?.trim() || row.parent_name?.trim() || null,
          parentPhone: row.parentphone?.trim() || row.parent_phone?.trim() || null,
          sectionId,
          schoolId,
        },
      });
      results.push({ name, success: true });
    } catch {
      results.push({ name, success: false, error: "Duplicate roll number or invalid data" });
    }
  }

  return NextResponse.json({ results });
}

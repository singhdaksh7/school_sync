import { prisma } from "@/lib/prisma";

/**
 * The eligible roster for a section's attendance session is simply every
 * Student currently assigned to that section — Student has no separate
 * active/enrolled flag, so section membership IS enrollment (a transferred-out
 * student's row moves sectionId, it never becomes "inactive" in place).
 */
export async function getEligibleStudentIds(schoolId: string, sectionId: string): Promise<string[]> {
  const students = await prisma.student.findMany({
    where: { schoolId, sectionId },
    select: { id: true },
    orderBy: { rollNo: "asc" },
  });
  return students.map((s) => s.id);
}

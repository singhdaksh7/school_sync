import { prisma } from "@/lib/prisma";
import { sortStudentsByRollNumber } from "@/lib/student-ordering";

/**
 * The eligible roster for a section's attendance session is simply every
 * Student currently assigned to that section — Student has no separate
 * active/enrolled flag, so section membership IS enrollment (a transferred-out
 * student's row moves sectionId, it never becomes "inactive" in place).
 *
 * Ordered by universal roll-number order (canonical comparator — see
 * /lib/student-ordering) — a section roster is small/bounded, so an
 * in-memory sort right after the fetch is correct and cheap; a plain string
 * `orderBy: { rollNo: "asc" }` would sort "10" before "2".
 */
export async function getEligibleStudentIds(schoolId: string, sectionId: string): Promise<string[]> {
  const students = await prisma.student.findMany({
    where: { schoolId, sectionId },
    select: { id: true, rollNo: true, name: true, admissionNo: true },
  });
  return sortStudentsByRollNumber(students).map((s) => s.id);
}

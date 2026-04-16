import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import PrintButton from "./PrintButton";

function getGrade(pct: number) {
  if (pct >= 90) return "A+";
  if (pct >= 75) return "A";
  if (pct >= 60) return "B";
  if (pct >= 45) return "C";
  if (pct >= 33) return "D";
  return "F";
}

export default async function ReportCardPage({
  params,
}: {
  params: Promise<{ schoolSlug: string; studentId: string }>;
}) {
  const { schoolSlug, studentId } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [student, schoolInfo, attendances, examResults] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, schoolId: school.id },
      include: { section: { include: { class: true } } },
    }),
    prisma.school.findUnique({ where: { id: school.id }, select: { name: true, address: true, logoUrl: true } }),
    prisma.attendance.findMany({
      where: { studentId, schoolId: school.id },
      select: { status: true },
    }),
    prisma.examResult.findMany({
      where: { studentId, exam: { scheme: { schoolId: school.id } } },
      include: { exam: { include: { scheme: { select: { id: true, name: true } } } } },
      orderBy: [{ exam: { scheme: { name: "asc" } } }, { exam: { order: "asc" } }],
    }),
  ]);

  if (!student || !schoolInfo) notFound();

  const totalDays = attendances.length;
  const presentDays = attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : null;

  const schemeMap = new Map<string, { schemeName: string; exams: { name: string; marks: number; maxMarks: number; order: number }[] }>();
  for (const r of examResults) {
    const key = r.exam.scheme.id;
    const entry = schemeMap.get(key) || { schemeName: r.exam.scheme.name, exams: [] };
    entry.exams.push({ name: r.exam.name, marks: r.marks, maxMarks: r.exam.maxMarks, order: r.exam.order });
    schemeMap.set(key, entry);
  }
  const schemes = Array.from(schemeMap.values()).map((s) => {
    const exams = s.exams.sort((a, b) => a.order - b.order);
    const totalMarks = exams.reduce((sum, e) => sum + e.marks, 0);
    const totalMax = exams.reduce((sum, e) => sum + e.maxMarks, 0);
    const pct = totalMax > 0 ? Math.round((totalMarks / totalMax) * 100) : null;
    return { schemeName: s.schemeName, exams, totalMarks, totalMax, pct };
  });

  const today = new Date();

  return (
    <>
      <div className="print:hidden mb-4 flex items-center gap-3">
        <Link href={`/dashboard/${schoolSlug}/students/${studentId}`}>
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
        <PrintButton />
      </div>

      <div className="report-card bg-white max-w-3xl mx-auto border border-gray-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:max-w-full print:mx-0">
        <div className="bg-blue-700 text-white px-8 py-6 print:py-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold print:text-xl">{schoolInfo.name}</h1>
              {schoolInfo.address && <p className="text-blue-200 text-sm mt-0.5">{schoolInfo.address}</p>}
              <p className="text-blue-200 text-xs mt-1">Progress Report — {format(today, "MMMM yyyy")}</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-xs">Generated</p>
              <p className="text-sm font-medium">{format(today, "dd MMM yyyy")}</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-5 border-b border-gray-100 print:py-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div><span className="text-gray-500">Student Name:</span> <span className="font-semibold text-gray-900">{student.name}</span></div>
            <div><span className="text-gray-500">Roll Number:</span> <span className="font-semibold text-gray-900">{student.rollNo}</span></div>
            <div><span className="text-gray-500">Class:</span> <span className="font-semibold text-gray-900">{student.section.class.name}</span></div>
            <div><span className="text-gray-500">Section:</span> <span className="font-semibold text-gray-900">{student.section.name}</span></div>
            {student.parentName && <div><span className="text-gray-500">Parent/Guardian:</span> <span className="font-semibold text-gray-900">{student.parentName}</span></div>}
            {student.email && <div><span className="text-gray-500">Email:</span> <span className="font-semibold text-gray-900">{student.email}</span></div>}
          </div>
        </div>

        <div className="px-8 py-4 bg-gray-50 border-b border-gray-100 print:py-3">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Attendance</p>
              <p className="text-2xl font-bold text-gray-900 print:text-xl">{attendancePct !== null ? `${attendancePct}%` : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Days Present</p>
              <p className="text-2xl font-bold text-gray-900 print:text-xl">{presentDays} / {totalDays}</p>
            </div>
            {attendancePct !== null && (
              <div className={`ml-auto px-4 py-2 rounded-lg text-sm font-semibold ${attendancePct >= 75 ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {attendancePct >= 75 ? "Satisfactory" : "Below Required (75%)"}
              </div>
            )}
          </div>
        </div>

        <div className="px-8 py-5 print:py-3">
          {schemes.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">No exam results recorded yet.</p>
          ) : (
            <div className="space-y-6 print:space-y-4">
              {schemes.map((scheme) => (
                <div key={scheme.schemeName}>
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3 print:mb-2">{scheme.schemeName}</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                        <th className="text-left pb-2 font-medium">Exam</th>
                        <th className="text-center pb-2 font-medium">Marks Obtained</th>
                        <th className="text-center pb-2 font-medium">Max Marks</th>
                        <th className="text-center pb-2 font-medium">%</th>
                        <th className="text-center pb-2 font-medium">Grade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {scheme.exams.map((exam) => {
                        const pct = Math.round((exam.marks / exam.maxMarks) * 100);
                        return (
                          <tr key={exam.name} className="text-gray-800">
                            <td className="py-2.5">{exam.name}</td>
                            <td className="py-2.5 text-center font-medium">{exam.marks}</td>
                            <td className="py-2.5 text-center text-gray-500">{exam.maxMarks}</td>
                            <td className="py-2.5 text-center">{pct}%</td>
                            <td className="py-2.5 text-center">
                              <span className={`font-bold text-xs px-2 py-0.5 rounded ${pct >= 75 ? "bg-green-50 text-green-700" : pct >= 45 ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"}`}>
                                {getGrade(pct)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 font-semibold text-gray-900">
                        <td className="pt-2.5">Total</td>
                        <td className="pt-2.5 text-center">{scheme.totalMarks}</td>
                        <td className="pt-2.5 text-center text-gray-500">{scheme.totalMax}</td>
                        <td className="pt-2.5 text-center">{scheme.pct}%</td>
                        <td className="pt-2.5 text-center">
                          {scheme.pct !== null && (
                            <span className={`font-bold text-xs px-2 py-0.5 rounded ${scheme.pct >= 75 ? "bg-green-100 text-green-700" : scheme.pct >= 45 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                              {getGrade(scheme.pct)}
                            </span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-8 py-4 border-t border-gray-100 flex justify-between text-xs text-gray-400 print:py-2">
          <span>{schoolInfo.name} · SchoolSync</span>
          <span>Printed on {format(today, "dd MMM yyyy")}</span>
        </div>
      </div>

      <style>{`
        @media print {
          .report-card { box-shadow: none; }
          nav, header, aside, .print\\:hidden { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </>
  );
}

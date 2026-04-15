"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface ReportData {
  student: {
    name: string; rollNo: string;
    section: { name: string; class: { name: string } };
    email: string | null; phone: string | null; parentName: string | null;
  };
  school: { name: string; address: string | null; logoUrl: string | null };
  attendancePct: number | null;
  presentDays: number;
  totalDays: number;
  schemes: {
    schemeName: string;
    exams: { name: string; marks: number; maxMarks: number }[];
    totalMarks: number;
    totalMax: number;
    pct: number | null;
  }[];
}

function getGrade(pct: number) {
  if (pct >= 90) return "A+";
  if (pct >= 75) return "A";
  if (pct >= 60) return "B";
  if (pct >= 45) return "C";
  if (pct >= 33) return "D";
  return "F";
}

export default function ReportCardPage() {
  const params = useParams();
  const router = useRouter();
  const schoolSlug = params.schoolSlug as string;
  const studentId = params.studentId as string;
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`)
      .then((r) => r.json())
      .then((school) =>
        fetch(`/api/schools/${school.id}/students/${studentId}/report-card`)
      )
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Could not load report card."); setLoading(false); });
  }, [schoolSlug, studentId]);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading report card...</div>;
  if (error || !data) return <div className="text-center py-20 text-red-400">{error || "Error"}</div>;

  const { student, school, attendancePct, presentDays, totalDays, schemes } = data;

  return (
    <>
      {/* Print controls — hidden when printing */}
      <div className="print:hidden mb-4 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button size="sm" onClick={() => window.print()} className="gap-2 ml-auto">
          <Printer className="w-4 h-4" /> Print / Save as PDF
        </Button>
      </div>

      {/* Report card — this is what prints */}
      <div className="report-card bg-white max-w-3xl mx-auto border border-gray-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:max-w-full print:mx-0">
        {/* Header */}
        <div className="bg-blue-700 text-white px-8 py-6 print:py-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold print:text-xl">{school.name}</h1>
              {school.address && <p className="text-blue-200 text-sm mt-0.5">{school.address}</p>}
              <p className="text-blue-200 text-xs mt-1">Progress Report — {format(new Date(), "MMMM yyyy")}</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-xs">Generated</p>
              <p className="text-sm font-medium">{format(new Date(), "dd MMM yyyy")}</p>
            </div>
          </div>
        </div>

        {/* Student info */}
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

        {/* Attendance summary */}
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

        {/* Exam results */}
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

        {/* Footer */}
        <div className="px-8 py-4 border-t border-gray-100 flex justify-between text-xs text-gray-400 print:py-2">
          <span>{school.name} · SchoolSync</span>
          <span>Printed on {format(new Date(), "dd MMM yyyy")}</span>
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

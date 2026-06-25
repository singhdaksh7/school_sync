import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { rankReplacementTeachers } from "@/lib/teacher-ranking";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DeletedTeacherDetailPage({
  params,
}: {
  params: Promise<{ schoolSlug: string; teacherId: string }>;
}) {
  const { schoolSlug, teacherId } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId: school.id, isDeleted: true },
    include: {
      deletedBy: { select: { name: true } },
      _count: {
        select: {
          homework: true,
          attendances: true,
          generatedReportCards: true,
          notebookChecks: true,
          leaveRequests: true,
        },
      },
    },
  });
  if (!teacher) notFound();

  const snapshotLog = await prisma.auditLog.findFirst({
    where: { schoolId: school.id, entityType: "Teacher", entityId: teacherId, action: "TEACHER_SOFT_DELETED" },
    orderBy: { createdAt: "desc" },
  });
  let classesHandled: string[] = [];
  let sectionsHandled: string[] = [];
  let mentorSectionName: string | null = null;
  if (snapshotLog?.metadata) {
    try {
      const parsed = JSON.parse(snapshotLog.metadata);
      classesHandled = parsed.classesHandled ?? [];
      sectionsHandled = parsed.sectionsHandled ?? [];
      mentorSectionName = parsed.mentorSectionName ?? null;
    } catch {
      // ignore malformed snapshot
    }
  }

  const recommendations = await rankReplacementTeachers(school.id, teacher.subject, teacher.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/dashboard/${schoolSlug}/teachers/deleted`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Deleted Teachers
      </Link>

      <div>
        <h2 className="text-2xl font-bold text-gray-900">{teacher.name}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {teacher.subject || "No subject"} · Deleted {teacher.deletedAt ? new Date(teacher.deletedAt).toLocaleDateString() : "—"}
          {teacher.deletedBy && ` by ${teacher.deletedBy.name}`}
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Historical Activity (read only)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            { label: "Homework given", value: teacher._count.homework },
            { label: "Attendance marked", value: teacher._count.attendances },
            { label: "Report cards generated", value: teacher._count.generatedReportCards },
            { label: "Notebook checks", value: teacher._count.notebookChecks },
            { label: "Leave requests", value: teacher._count.leaveRequests },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-gray-50 px-3 py-3 text-center">
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Classes &amp; Sections Handled</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {mentorSectionName && (
            <p className="text-sm text-gray-600">Was mentor of <strong>Section {mentorSectionName}</strong>.</p>
          )}
          {sectionsHandled.length === 0 ? (
            <p className="text-sm text-gray-400">No timetable assignments recorded at time of deletion.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sectionsHandled.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
            </div>
          )}
          {classesHandled.length > 0 && (
            <p className="text-xs text-gray-400">Classes: {classesHandled.join(", ")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Replacement Recommendations</CardTitle>
          <p className="text-sm text-gray-500">
            Active teachers best suited to take over this workload — same subject first, then lowest current load.
          </p>
        </CardHeader>
        <CardContent>
          {recommendations.length === 0 ? (
            <p className="text-sm text-gray-400">No other active teachers in this school.</p>
          ) : (
            <div className="space-y-2">
              {recommendations.slice(0, 5).map((rec, i) => (
                <div key={rec.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{i === 0 ? "Recommended: " : ""}{rec.name}</p>
                    <p className="text-xs text-gray-500">{rec.subject || "No subject"}</p>
                  </div>
                  <Badge variant="outline">{rec.periodsPerWeek} periods/week</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

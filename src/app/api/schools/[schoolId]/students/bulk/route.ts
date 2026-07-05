import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { getStudentLimitInfo } from "@/lib/plan-limits";
import { importStudentRows, type ImportRow } from "@/lib/student-import";
import { createJob, isJobWorkerConfigured, STUDENT_BULK_IMPORT_SYNC_LIMIT } from "@/lib/jobs";
import { storeJsonSource } from "@/lib/file-service";
import { enforceUploadQuota } from "@/lib/api-cost-guard";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { students } = await req.json();
  if (!Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: "No students provided" }, { status: 400 });
  }

  // Large imports must not run inline in the request (serverless runtime
  // limits) — above the threshold, the source rows are stored as a private
  // managed object and a durable job processes them. We refuse to accept a
  // job that could never run rather than creating invisible stuck work.
  if (students.length > STUDENT_BULK_IMPORT_SYNC_LIMIT) {
    if (!isJobWorkerConfigured()) {
      return NextResponse.json(
        { error: "Bulk student import is temporarily unavailable. Please try a smaller file." },
        { status: 503 }
      );
    }

    const denied = await enforceUploadQuota({ schoolId, actorType: role ?? "USER", actorId: session.user.id }, "STUDENT_IMPORT_SOURCE");
    if (denied) return denied;

    const stored = await storeJsonSource({
      category: "STUDENT_IMPORT_SOURCE",
      schoolId,
      json: students,
      uploader: { type: "USER", id: session.user.id },
    });
    if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status });

    const created = await createJob({
      type: "STUDENT_BULK_IMPORT",
      schoolId,
      createdById: session.user.id,
      payload: { schoolId, createdById: session.user.id, storedFileId: stored.file.id, rowCount: students.length },
      totalItems: students.length,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

    return NextResponse.json(
      { mode: "job", jobId: created.job.id, status: created.job.status, totalItems: students.length },
      { status: 202 }
    );
  }

  // maxStudents is re-evaluated here (processing time), not just at whatever
  // point the admin opened the import dialog.
  const { maxStudents, currentCount } = await getStudentLimitInfo(schoolId);
  const summary = await importStudentRows(schoolId, students as ImportRow[], { maxStudents, currentCount });

  return NextResponse.json({ results: summary.results });
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, Phone, User, BookOpen, ClipboardCheck, Award, GraduationCap, FileText, ArrowRightLeft, X, History } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";

interface AttendanceRecord { id: string; date: string; status: "PRESENT" | "ABSENT" | "LATE" }
interface ExamResult { id: string; marks: number; exam: { id: string; name: string; maxMarks: number; order: number; scheme: { id: string; name: string } } }
interface StudentDetail {
  id: string; name: string; rollNo: string; email: string | null; phone: string | null;
  parentName: string | null; parentPhone: string | null;
  section: { id: string; name: string; class: { name: string } };
  attendances: AttendanceRecord[];
  examResults: ExamResult[];
}
interface ClassWithSections { id: string; name: string; sections: { id: string; name: string }[] }
interface TransferRecord {
  id: string; createdAt: string; reason: string | null;
  fromSection: { name: string; class: { name: string } };
  toSection: { name: string; class: { name: string } };
  transferredBy: { name: string | null };
}

const STATUS_CONFIG = {
  PRESENT: { label: "P", color: "bg-green-100 text-green-700 border-green-200" },
  ABSENT: { label: "A", color: "bg-red-100 text-red-700 border-red-200" },
  LATE: { label: "L", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
};

function TransferDialog({
  schoolId, studentId, currentSectionId, classes, onSuccess, onClose,
}: {
  schoolId: string; studentId: string; currentSectionId: string;
  classes: ClassWithSections[]; onSuccess: () => void; onClose: () => void;
}) {
  const [toSectionId, setToSectionId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allSections = classes.flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, label: `Class ${c.name} — Section ${s.name}` }))
  ).filter((s) => s.id !== currentSectionId);

  const handleSubmit = async () => {
    if (!toSectionId) { setError("Please select a target section."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/schools/${schoolId}/students/${studentId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toSectionId, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to transfer."); setSaving(false); return; }
      onSuccess();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-purple-600" />
            <h3 className="font-semibold text-gray-900">Transfer Section</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Transfer to</label>
            <select value={toSectionId} onChange={(e) => setToSectionId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="">— Select section —</option>
              {allSections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Parent request, capacity adjustment..."
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !toSectionId} className="bg-purple-600 hover:bg-purple-700 text-white">
            {saving ? "Transferring…" : "Transfer"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  initialStudent: StudentDetail;
  initialClasses: ClassWithSections[];
  initialTransfers: TransferRecord[];
  schoolId: string;
  schoolSlug: string;
}

export default function StudentProfileClient({ initialStudent, initialClasses, initialTransfers, schoolId, schoolSlug }: Props) {
  const router = useRouter();
  const [student, setStudent] = useState<StudentDetail>(initialStudent);
  const [classes] = useState<ClassWithSections[]>(initialClasses);
  const [transfers, setTransfers] = useState<TransferRecord[]>(initialTransfers);
  const [showTransfer, setShowTransfer] = useState(false);

  const handleTransferSuccess = async () => {
    setShowTransfer(false);
    const [updatedStudent, updatedTransfers] = await Promise.all([
      fetch(`/api/schools/${schoolId}/students/${student.id}`).then((r) => r.json()),
      fetch(`/api/schools/${schoolId}/students/${student.id}/transfer`).then((r) => r.json()),
    ]);
    setStudent(updatedStudent);
    setTransfers(updatedTransfers);
  };

  const totalMarked = student.attendances.length;
  const presentCount = student.attendances.filter((a) => a.status === "PRESENT").length;
  const absentCount = student.attendances.filter((a) => a.status === "ABSENT").length;
  const lateCount = student.attendances.filter((a) => a.status === "LATE").length;
  const attendancePct = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : null;

  const resultsByScheme = student.examResults.reduce((acc, r) => {
    const key = r.exam.scheme.id;
    if (!acc[key]) acc[key] = { scheme: r.exam.scheme, results: [] };
    acc[key].results.push(r);
    return acc;
  }, {} as Record<string, { scheme: { id: string; name: string }; results: ExamResult[] }>);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/${schoolSlug}/students`)} className="gap-2 text-gray-500 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back to Students
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 text-purple-600 border-purple-200 hover:bg-purple-50" onClick={() => setShowTransfer(true)}>
            <ArrowRightLeft className="w-4 h-4" /> Transfer Section
          </Button>
          <Link href={`/dashboard/${schoolSlug}/reports/report-card/${student.id}`}>
            <Button variant="outline" size="sm" className="gap-2"><FileText className="w-4 h-4" /> Report Card</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 pb-6">
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center text-2xl font-bold text-green-700 flex-shrink-0">
              {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl font-bold text-gray-900">{student.name}</h2>
                <Badge variant="outline" className="font-mono">Roll: {student.rollNo}</Badge>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <BookOpen className="w-4 h-4 text-gray-400" />
                <span className="text-gray-500 text-sm">Class {student.section.class.name} — Section {student.section.name}</span>
              </div>
              <div className="flex flex-wrap gap-4 mt-3">
                {student.email && <div className="flex items-center gap-1.5 text-sm text-gray-500"><Mail className="w-3.5 h-3.5 text-gray-400" /> {student.email}</div>}
                {student.phone && <div className="flex items-center gap-1.5 text-sm text-gray-500"><Phone className="w-3.5 h-3.5 text-gray-400" /> {student.phone}</div>}
                {student.parentName && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <User className="w-3.5 h-3.5 text-gray-400" /> {student.parentName}
                    {student.parentPhone && <span>· {student.parentPhone}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-1"><ClipboardCheck className="w-4 h-4 text-blue-600" /><p className="text-xs text-gray-500 font-medium">Attendance</p></div>
          <p className={cn("text-2xl font-bold", attendancePct === null ? "text-gray-400" : attendancePct >= 75 ? "text-green-600" : "text-red-600")}>{attendancePct !== null ? `${attendancePct}%` : "—"}</p>
          <p className="text-xs text-gray-400 mt-0.5">{totalMarked} days marked</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-gray-500 font-medium mb-1">Present</p><p className="text-2xl font-bold text-green-600">{presentCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-gray-500 font-medium mb-1">Absent</p><p className={cn("text-2xl font-bold", absentCount > 0 ? "text-red-600" : "text-gray-400")}>{absentCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-gray-500 font-medium mb-1">Late</p><p className={cn("text-2xl font-bold", lateCount > 0 ? "text-yellow-600" : "text-gray-400")}>{lateCount}</p></CardContent></Card>
      </div>

      {Object.keys(resultsByScheme).length > 0 ? (
        <div className="space-y-4">
          {Object.values(resultsByScheme).map(({ scheme, results }) => {
            const totalMarks = results.reduce((s, r) => s + r.marks, 0);
            const maxMarks = results.reduce((s, r) => s + r.exam.maxMarks, 0);
            const pct = maxMarks > 0 ? Math.round((totalMarks / maxMarks) * 100) : 0;
            const sorted = [...results].sort((a, b) => a.exam.order - b.exam.order);
            return (
              <Card key={scheme.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <div className="flex items-center gap-2"><Award className="w-4 h-4 text-amber-500" />{scheme.name}</div>
                    <Badge variant="secondary" className={cn("text-sm", pct >= 60 ? "bg-green-100 text-green-700" : pct >= 33 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700")}>
                      {totalMarks}/{maxMarks} ({pct}%)
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {sorted.map((r) => {
                      const examPct = r.exam.maxMarks > 0 ? Math.round((r.marks / r.exam.maxMarks) * 100) : 0;
                      return (
                        <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                          <span className="text-sm font-medium text-gray-700">{r.exam.name}</span>
                          <div className="flex items-center gap-3">
                            <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full", examPct >= 60 ? "bg-green-500" : examPct >= 33 ? "bg-yellow-500" : "bg-red-500")} style={{ width: `${examPct}%` }} />
                            </div>
                            <span className="text-sm font-semibold text-gray-900 min-w-[4rem] text-right">{r.marks} <span className="text-gray-400 font-normal">/ {r.exam.maxMarks}</span></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><CardContent className="py-10 text-center"><GraduationCap className="w-8 h-8 text-gray-300 mx-auto mb-2" /><p className="text-gray-400 text-sm">No exam results yet</p></CardContent></Card>
      )}

      {student.attendances.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-blue-600" />Recent Attendance (last {student.attendances.length} records)</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {student.attendances.map((a) => {
                const cfg = STATUS_CONFIG[a.status];
                return (
                  <div key={a.id} title={`${formatDate(a.date)} — ${a.status}`} className={cn("w-9 h-9 rounded-lg border flex flex-col items-center justify-center cursor-default", cfg.color)}>
                    <span className="text-xs font-bold">{cfg.label}</span>
                    <span className="text-[9px] opacity-60">{new Date(a.date).getDate()}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-200 inline-block" /> Present</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" /> Absent</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 inline-block" /> Late</span>
            </div>
          </CardContent>
        </Card>
      )}

      {transfers.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4 text-purple-600" />Transfer History</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0 divide-y divide-gray-50">
              {transfers.map((t) => (
                <div key={t.id} className="py-3 flex items-center gap-3">
                  <ArrowRightLeft className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Class {t.fromSection.class.name} — {t.fromSection.name}</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <span className="font-medium">Class {t.toSection.class.name} — {t.toSection.name}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(t.createdAt).toLocaleDateString()} · by {t.transferredBy.name || "Admin"}
                      {t.reason && <span> · {t.reason}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showTransfer && (
        <TransferDialog
          schoolId={schoolId}
          studentId={student.id}
          currentSectionId={student.section.id}
          classes={classes}
          onSuccess={handleTransferSuccess}
          onClose={() => setShowTransfer(false)}
        />
      )}
    </div>
  );
}

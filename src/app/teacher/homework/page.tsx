"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CheckCircle2, ExternalLink, FileCheck2, Save, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type LegacySubmissionStatus = "PENDING" | "SUBMITTED" | "NOT_SUBMITTED" | "LATE" | "CHECKED" | "REJECTED";
type AcademicStatus = "PENDING" | "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";
type SubmissionMethod = "NONE" | "ONLINE" | "PHYSICAL";
type HomeworkSubmissionReviewStatus = "SUBMITTED" | "LATE" | "REVIEWED" | "REJECTED";
type HomeworkStatus = "ACTIVE" | "CLOSED" | "CANCELLED";
type TabKey = "PENDING" | "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";

interface Student { id: string; name: string; rollNo: string }
interface Assignment {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  students: Student[];
}
interface HomeworkStudentStatus {
  id: string;
  studentId: string;
  status: LegacySubmissionStatus;
  submissionStatus: AcademicStatus;
  submissionMethod: SubmissionMethod;
  submittedAt: string | null;
  checkedAt: string | null;
  score: number | null;
  maxScore: number | null;
  teacherRemark: string | null;
  student: Student;
}
interface HomeworkSubmission {
  id: string;
  homeworkId: string;
  studentId: string;
  attachmentUrl: string | null;
  fileName: string | null;
  fileType: string | null;
  submittedAt: string;
  checkedAt: string | null;
  status: HomeworkSubmissionReviewStatus;
  submissionStatus: AcademicStatus;
  submissionMethod: SubmissionMethod;
  teacherRemark: string | null;
  score: number | null;
  maxScore: number | null;
  student: Student;
  guardian: { id: string; name: string; phone: string } | null;
}
interface Homework {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  dueDate: string;
  deadlineAt: string;
  attachmentUrl: string | null;
  status: HomeworkStatus;
  section: { name: string; class: { name: string } };
  teacher: { name: string };
  studentStatuses: HomeworkStudentStatus[];
  submissions: HomeworkSubmission[];
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "LATE_SUBMITTED", label: "Late" },
  { key: "NOT_SUBMITTED", label: "Not Submitted" },
  { key: "CHECKED", label: "Checked" },
  { key: "REJECTED", label: "Rejected" },
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  CLOSED: "bg-gray-50 text-gray-700 border-gray-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  LATE_SUBMITTED: "bg-orange-50 text-orange-700 border-orange-200",
  NOT_SUBMITTED: "bg-red-50 text-red-700 border-red-200",
  CHECKED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function academicLabel(status: AcademicStatus) {
  return status.replace("_", " ");
}

function toDeadlineIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function TeacherHomeworkPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [selectedAssignmentKey, setSelectedAssignmentKey] = useState("");
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", attachmentUrl: "" });
  const [selectedHomeworkId, setSelectedHomeworkId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("PENDING");
  const [drafts, setDrafts] = useState<Record<string, { score: string; maxScore: string; teacherRemark: string }>>({});
  const [saving, setSaving] = useState(false);
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadHomework = useCallback(async () => {
    const homeworkRes = await fetch("/api/teacher/homework");
    const homeworkData = await homeworkRes.json();
    if (!homeworkData.error) {
      setAssignments(homeworkData.assignments || []);
      setHomework(homeworkData.homework || []);
    } else {
      setMessage(homeworkData.error);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadHomework();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadHomework]);

  const selectedAssignment = useMemo(() => {
    return assignments.find((assignment) => `${assignment.sectionId}|${assignment.subject}` === selectedAssignmentKey) || null;
  }, [assignments, selectedAssignmentKey]);

  const selectedHomework = useMemo(() => {
    return homework.find((item) => item.id === selectedHomeworkId) || homework[0] || null;
  }, [homework, selectedHomeworkId]);

  useEffect(() => {
    if (!selectedHomework) return;
    const id = window.setTimeout(() => {
      const next: typeof drafts = {};
      selectedHomework.studentStatuses.forEach((item) => {
        const submission = selectedHomework.submissions.find((entry) => entry.studentId === item.studentId);
        next[item.studentId] = {
          score: (submission?.score ?? item.score) === null ? "" : String(submission?.score ?? item.score),
          maxScore: (submission?.maxScore ?? item.maxScore) === null ? "" : String(submission?.maxScore ?? item.maxScore),
          teacherRemark: submission?.teacherRemark ?? item.teacherRemark ?? "",
        };
      });
      setDrafts(next);
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectedHomework]);

  async function createHomework() {
    if (!selectedAssignment) {
      setMessage("Select a section and subject.");
      return;
    }
    if (!form.title.trim() || !form.dueDate) {
      setMessage("Title and deadline are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    const res = await fetch("/api/teacher/homework", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId: selectedAssignment.sectionId,
        subject: selectedAssignment.subject,
        title: form.title,
        description: form.description,
        dueDate: toDeadlineIso(form.dueDate),
        attachmentUrl: form.attachmentUrl,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error || "Could not create homework.");
      return;
    }
    setForm({ title: "", description: "", dueDate: "", attachmentUrl: "" });
    setSelectedAssignmentKey("");
    await loadHomework();
    setSelectedHomeworkId(data.id);
    setMessage("Homework created.");
  }

  async function updateHomeworkStatus(id: string, status: HomeworkStatus) {
    const res = await fetch(`/api/teacher/homework/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Could not update homework.");
      return;
    }
    await loadHomework();
    setMessage(status === "CLOSED" ? "Homework closed." : "Homework updated.");
  }

  async function saveStudentStatus(item: HomeworkStudentStatus, status: "SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED") {
    if (!selectedHomework) return;
    const draft = drafts[item.studentId] || { score: "", maxScore: "", teacherRemark: "" };
    const now = new Date().toISOString();
    const submittedAt = status === "NOT_SUBMITTED" ? null : item.submittedAt || now;
    const payload = {
      studentId: item.studentId,
      status,
      submissionMethod: status === "NOT_SUBMITTED" ? "NONE" : item.submissionMethod === "ONLINE" ? "ONLINE" : "PHYSICAL",
      submittedAt,
      score: status === "CHECKED" ? draft.score || null : null,
      maxScore: status === "CHECKED" ? draft.maxScore || null : null,
      teacherRemark: draft.teacherRemark || null,
    };

    setRowSavingId(item.studentId);
    setMessage("");
    const res = await fetch(`/api/teacher/homework/${selectedHomework.id}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: [payload] }),
    });
    const data = await res.json();
    setRowSavingId(null);
    if (!res.ok) {
      setMessage(data.error || "Could not update homework record.");
      return;
    }
    await loadHomework();
    setMessage("Homework record updated.");
  }

  async function saveOnlineReview(submission: HomeworkSubmission, status: "REVIEWED" | "REJECTED") {
    if (!selectedHomework) return;
    const draft = drafts[submission.studentId] || { score: "", maxScore: "", teacherRemark: "" };
    setRowSavingId(submission.studentId);
    setMessage("");
    const res = await fetch(`/api/teacher/homework/${selectedHomework.id}/submissions/${submission.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        score: status === "REVIEWED" ? draft.score || null : null,
        maxScore: status === "REVIEWED" ? draft.maxScore || null : null,
        teacherRemark: draft.teacherRemark || null,
      }),
    });
    const data = await res.json();
    setRowSavingId(null);
    if (!res.ok) {
      setMessage(data.error || "Could not save submission review.");
      return;
    }
    await loadHomework();
    setMessage("Submission review saved.");
  }

  const selectedRecords = useMemo(() => {
    if (!selectedHomework) return [];
    return selectedHomework.studentStatuses
      .map((item) => {
        const submission = selectedHomework.submissions.find((entry) => entry.studentId === item.studentId) || null;
        const status = submission?.submissionStatus ?? item.submissionStatus;
        const method = submission?.submissionMethod ?? item.submissionMethod;
        return { item, submission, status, method };
      })
      .filter((record) => record.status === activeTab);
  }, [activeTab, selectedHomework]);

  const tabCounts = useMemo(() => {
    const counts = Object.fromEntries(TABS.map((tab) => [tab.key, 0])) as Record<TabKey, number>;
    if (!selectedHomework) return counts;
    selectedHomework.studentStatuses.forEach((item) => {
      const submission = selectedHomework.submissions.find((entry) => entry.studentId === item.studentId);
      const status = submission?.submissionStatus ?? item.submissionStatus;
      counts[status] += 1;
    });
    return counts;
  }, [selectedHomework]);

  const canEdit = selectedHomework?.status !== "CANCELLED";
  const afterDeadline = selectedHomework ? new Date() > new Date(selectedHomework.deadlineAt) : false;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Homework</h1>
        <p className="text-sm text-gray-500 mt-1">Create homework, track online and physical submissions, and keep homework marks separate from final report cards.</p>
      </div>
      {message && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Create Homework</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Select value={selectedAssignmentKey} onValueChange={setSelectedAssignmentKey}>
            <SelectTrigger><SelectValue placeholder="Section + subject" /></SelectTrigger>
            <SelectContent>
              {assignments.map((assignment) => (
                <SelectItem key={`${assignment.sectionId}|${assignment.subject}`} value={`${assignment.sectionId}|${assignment.subject}`}>
                  Class {assignment.className}-{assignment.sectionName} - {assignment.subject}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          <Input aria-label="Deadline date and time" type="datetime-local" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
          <Input placeholder="Attachment URL" value={form.attachmentUrl} onChange={(e) => setForm((prev) => ({ ...prev, attachmentUrl: e.target.value }))} />
          <Button onClick={createHomework} disabled={saving || assignments.length === 0} className="gap-2">
            <BookOpenCheck className="w-4 h-4" /> {saving ? "Saving..." : "Assign"}
          </Button>
          <textarea
            className="md:col-span-5 min-h-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Homework List</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {homework.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No homework assigned yet.</p>
            ) : homework.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedHomeworkId(item.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                  selectedHomework?.id === item.id ? "border-blue-300 bg-blue-50" : "border-gray-100 bg-white hover:bg-gray-50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-1">Class {item.section.class.name}-{item.section.name} - {item.subject}</p>
                    <p className="text-xs text-gray-400 mt-1">Deadline {formatDate(item.deadlineAt)}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[item.status])}>{item.status}</Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-3">
              <span>{selectedHomework ? selectedHomework.title : "Homework Tracking"}</span>
              {selectedHomework && selectedHomework.status === "ACTIVE" && (
                <Button variant="outline" size="sm" onClick={() => updateHomeworkStatus(selectedHomework.id, "CLOSED")}>Close</Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedHomework ? (
              <p className="text-sm text-gray-500 py-12 text-center">Select homework to track.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                  <Badge variant="outline" className={cn(STATUS_COLORS[selectedHomework.status])}>{selectedHomework.status}</Badge>
                  <span>Class {selectedHomework.section.class.name}-{selectedHomework.section.name}</span>
                  <span>-</span>
                  <span>{selectedHomework.subject}</span>
                  <span>-</span>
                  <span>Deadline {formatDate(selectedHomework.deadlineAt)}</span>
                </div>
                {!canEdit && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Cancelled homework cannot be edited.</p>}

                <div className="flex flex-wrap gap-2">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        activeTab === tab.key ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      {tab.label} <span className="ml-1 text-xs text-gray-400">{tabCounts[tab.key]}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {selectedRecords.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">No students in this tab.</p>
                  ) : selectedRecords.map(({ item, submission, status, method }) => {
                    const draft = drafts[item.studentId] || { score: "", maxScore: "", teacherRemark: "" };
                    const savingRow = rowSavingId === item.studentId;
                    return (
                      <div key={item.id} className="rounded-lg border border-gray-100 p-3 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{item.student.name}</p>
                            <p className="text-xs text-gray-400">Roll {item.student.rollNo}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[status])}>{academicLabel(status)}</Badge>
                            <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">{method}</Badge>
                          </div>
                        </div>

                        <div className="grid gap-3 text-xs text-gray-500 md:grid-cols-3">
                          <div><span className="font-medium text-gray-700">Submitted:</span> {formatDate(submission?.submittedAt ?? item.submittedAt)}</div>
                          <div><span className="font-medium text-gray-700">Checked:</span> {formatDate(submission?.checkedAt ?? item.checkedAt)}</div>
                          <div>
                            {submission?.attachmentUrl ? (
                              <a href={submission.attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700">
                                <ExternalLink className="w-3 h-3" /> {submission.fileName || "Attachment"}
                              </a>
                            ) : (
                              <span className="text-gray-400">No attachment</span>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-[90px_90px_1fr_auto] md:items-center">
                          <Input
                            type="number"
                            min={0}
                            placeholder="Score"
                            value={draft.score}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, score: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <Input
                            type="number"
                            min={0}
                            placeholder="Max"
                            value={draft.maxScore}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, maxScore: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <Input
                            placeholder="Remark"
                            value={draft.teacherRemark}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, teacherRemark: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => saveStudentStatus(item, "SUBMITTED")} disabled={!canEdit || method === "ONLINE" || savingRow} className="gap-1">
                              <FileCheck2 className="w-3.5 h-3.5" /> Physical
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => saveStudentStatus(item, "NOT_SUBMITTED")} disabled={!canEdit || !afterDeadline || savingRow}>
                              Not Submitted
                            </Button>
                            {submission?.submissionMethod === "ONLINE" ? (
                              <>
                                <Button size="sm" onClick={() => saveOnlineReview(submission, "REVIEWED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Check
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => saveOnlineReview(submission, "REJECTED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" onClick={() => saveStudentStatus(item, "CHECKED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <Save className="w-3.5 h-3.5" /> Check
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => saveStudentStatus(item, "REJECTED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

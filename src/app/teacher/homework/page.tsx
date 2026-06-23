"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, BookOpenCheck, CheckCircle2, ExternalLink, FileCheck2, Save, XCircle, CheckCheck, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useTeacherPermissions } from "@/hooks/useTeacherPermissions";
import { useTranslation } from "@/lib/i18n/LanguageContext";

const COMPLETED_STATUSES: AcademicStatus[] = ["SUBMITTED", "LATE_SUBMITTED", "CHECKED"];

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

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: "PENDING", labelKey: "teacherHomework.tabPending" },
  { key: "SUBMITTED", labelKey: "teacherHomework.tabSubmitted" },
  { key: "LATE_SUBMITTED", labelKey: "teacherHomework.tabLate" },
  { key: "NOT_SUBMITTED", labelKey: "teacherHomework.tabNotSubmitted" },
  { key: "CHECKED", labelKey: "teacherHomework.tabChecked" },
  { key: "REJECTED", labelKey: "teacherHomework.tabRejected" },
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
  // A date-only input (e.g. "2026-07-15") has no time component — default to
  // end of day so a single date pick is enough. (A `datetime-local` input
  // requires the user to fill in every segment, date AND time, or its value
  // silently stays empty — switching to a plain date input avoids that trap.)
  const withTime = value.includes("T") ? value : `${value}T23:59:00`;
  const date = new Date(withTime);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function TeacherHomeworkPage() {
  const { t } = useTranslation();
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
  const [completionOverrides, setCompletionOverrides] = useState<Record<string, boolean>>({});
  const [completionSavingIds, setCompletionSavingIds] = useState<Set<string>>(new Set());
  const [bulkCompletionSaving, setBulkCompletionSaving] = useState(false);

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

  useEffect(() => {
    const id = window.setTimeout(() => setCompletionOverrides({}), 0);
    return () => window.clearTimeout(id);
  }, [selectedHomework?.id]);

  function isItemCompleted(item: HomeworkStudentStatus) {
    const override = completionOverrides[item.studentId];
    if (override !== undefined) return override;
    return COMPLETED_STATUSES.includes(item.submissionStatus);
  }

  async function toggleCompletion(item: HomeworkStudentStatus, completed: boolean) {
    if (!selectedHomework) return;
    setCompletionOverrides((prev) => ({ ...prev, [item.studentId]: completed }));
    setCompletionSavingIds((prev) => new Set(prev).add(item.studentId));
    setMessage("");
    const res = await fetch(`/api/teacher/homework/${selectedHomework.id}/completion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completions: [{ studentId: item.studentId, completed }] }),
    });
    setCompletionSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.studentId);
      return next;
    });
    if (!res.ok) {
      const data = await res.json();
      setCompletionOverrides((prev) => ({ ...prev, [item.studentId]: !completed }));
      setMessage(data.error || t("teacherHomework.couldNotUpdateCompletion"));
      return;
    }
    await loadHomework();
  }

  async function bulkSetCompletion(completed: boolean) {
    if (!selectedHomework) return;
    const completions = selectedHomework.studentStatuses.map((item) => ({ studentId: item.studentId, completed }));
    setCompletionOverrides(Object.fromEntries(completions.map((c) => [c.studentId, c.completed])));
    setBulkCompletionSaving(true);
    setMessage("");
    const res = await fetch(`/api/teacher/homework/${selectedHomework.id}/completion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completions }),
    });
    setBulkCompletionSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setCompletionOverrides({});
      setMessage(data.error || t("teacherHomework.couldNotUpdateCompletion"));
      return;
    }
    await loadHomework();
    setMessage(completed ? t("teacherHomework.allMarkedCompleted") : t("teacherHomework.allMarkedNotCompleted"));
  }

  async function createHomework() {
    if (!selectedAssignment) {
      setMessage(t("teacherHomework.selectSectionAndSubject"));
      return;
    }
    if (!form.title.trim() || !form.dueDate) {
      setMessage(t("teacherHomework.titleAndDeadlineRequired"));
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
      setMessage(data.error || t("teacherHomework.couldNotCreate"));
      return;
    }
    setForm({ title: "", description: "", dueDate: "", attachmentUrl: "" });
    setSelectedAssignmentKey("");
    await loadHomework();
    setSelectedHomeworkId(data.id);
    setMessage(t("teacherHomework.homeworkCreated"));
  }

  async function updateHomeworkStatus(id: string, status: HomeworkStatus) {
    const res = await fetch(`/api/teacher/homework/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || t("teacherHomework.couldNotUpdate"));
      return;
    }
    await loadHomework();
    setMessage(status === "CLOSED" ? t("teacherHomework.homeworkClosed") : t("teacherHomework.homeworkUpdated"));
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
      setMessage(data.error || t("teacherHomework.couldNotUpdateRecord"));
      return;
    }
    await loadHomework();
    setMessage(t("teacherHomework.recordUpdated"));
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
      setMessage(data.error || t("teacherHomework.couldNotSaveReview"));
      return;
    }
    await loadHomework();
    setMessage(t("teacherHomework.reviewSaved"));
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

  const { has: hasPermission } = useTeacherPermissions();
  const canCreate = hasPermission("HOMEWORK", "CREATE");
  const canReview = hasPermission("HOMEWORK", "REVIEW");
  const canEdit = selectedHomework?.status !== "CANCELLED" && canReview;
  const afterDeadline = selectedHomework ? new Date() > new Date(selectedHomework.deadlineAt) : false;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("teacherHomework.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("teacherHomework.subtitle")}</p>
        </div>
        <Link href="/teacher/homework/dashboard">
          <Button variant="outline" size="sm" className="gap-2">
            <BarChart3 className="w-4 h-4" /> {t("teacherHomework.classDashboard")}
          </Button>
        </Link>
      </div>
      {message && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}

      {canCreate && (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t("teacherHomework.createHomework")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Select value={selectedAssignmentKey} onValueChange={setSelectedAssignmentKey}>
            <SelectTrigger><SelectValue placeholder={t("teacherHomework.sectionSubjectPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {assignments.map((assignment) => (
                <SelectItem key={`${assignment.sectionId}|${assignment.subject}`} value={`${assignment.sectionId}|${assignment.subject}`}>
                  {t("teacherHomework.classSectionSubject", { className: assignment.className, sectionName: assignment.sectionName, subject: assignment.subject })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder={t("teacherHomework.titlePlaceholder")} value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          <Input aria-label={t("teacherHomework.dueDate")} type="date" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
          <Input placeholder={t("teacherHomework.attachmentUrlPlaceholder")} value={form.attachmentUrl} onChange={(e) => setForm((prev) => ({ ...prev, attachmentUrl: e.target.value }))} />
          <Button onClick={createHomework} disabled={saving || assignments.length === 0} className="gap-2">
            <BookOpenCheck className="w-4 h-4" /> {saving ? t("teacherHomework.saving") : t("teacherHomework.assign")}
          </Button>
          <textarea
            className="md:col-span-5 min-h-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("teacherHomework.descriptionPlaceholder")}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </CardContent>
      </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">{t("teacherHomework.homeworkList")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {homework.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">{t("teacherHomework.noHomeworkYet")}</p>
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
                    <p className="text-xs text-gray-500 mt-1">{t("teacherHomework.classSectionSubjectShort", { className: item.section.class.name, sectionName: item.section.name, subject: item.subject })}</p>
                    <p className="text-xs text-gray-400 mt-1">{t("teacherHomework.deadlineLabel", { date: formatDate(item.deadlineAt) })}</p>
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
              <span>{selectedHomework ? selectedHomework.title : t("teacherHomework.homeworkTracking")}</span>
              {selectedHomework && selectedHomework.status === "ACTIVE" && (
                <Button variant="outline" size="sm" onClick={() => updateHomeworkStatus(selectedHomework.id, "CLOSED")}>{t("teacherHomework.close")}</Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedHomework ? (
              <p className="text-sm text-gray-500 py-12 text-center">{t("teacherHomework.selectHomeworkToTrack")}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                  <Badge variant="outline" className={cn(STATUS_COLORS[selectedHomework.status])}>{selectedHomework.status}</Badge>
                  <span>{t("teacherHomework.classSectionSubjectShort", { className: selectedHomework.section.class.name, sectionName: selectedHomework.section.name, subject: selectedHomework.subject })}</span>
                  <span>-</span>
                  <span>{t("teacherHomework.deadlineLabel", { date: formatDate(selectedHomework.deadlineAt) })}</span>
                </div>
                {!canEdit && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {selectedHomework.status === "CANCELLED"
                      ? t("teacherHomework.cancelledCannotEdit")
                      : t("teacherHomework.noPermissionToReview")}
                  </p>
                )}

                <Tabs defaultValue="completion">
                  <TabsList>
                    <TabsTrigger value="completion">{t("teacherHomework.quickCompletion")}</TabsTrigger>
                    <TabsTrigger value="review">{t("teacherHomework.submissionsAndScores")}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="completion">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {t("teacherHomework.checkOnceVerified")}
                        </p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => bulkSetCompletion(true)} disabled={!canEdit || bulkCompletionSaving} className="gap-1">
                            <CheckCheck className="w-3.5 h-3.5" /> {t("teacherHomework.markAllCompleted")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => bulkSetCompletion(false)} disabled={!canEdit || bulkCompletionSaving} className="gap-1">
                            <Square className="w-3.5 h-3.5" /> {t("teacherHomework.markAllNotCompleted")}
                          </Button>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                        {selectedHomework.studentStatuses.map((item) => {
                          const completed = isItemCompleted(item);
                          const saving = completionSavingIds.has(item.studentId);
                          return (
                            <label
                              key={item.id}
                              className={cn(
                                "flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors",
                                canEdit && !saving && "cursor-pointer hover:bg-gray-50"
                              )}
                            >
                              <div>
                                <p className="font-medium text-gray-900">{item.student.name}</p>
                                <p className="text-xs text-gray-400">{t("teacherHomework.rollLabel", { roll: item.student.rollNo })}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                {saving && <span className="text-xs text-gray-400">{t("teacherHomework.saving")}</span>}
                                <Checkbox
                                  checked={completed}
                                  disabled={!canEdit || saving}
                                  onCheckedChange={(checked) => toggleCompletion(item, checked === true)}
                                />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="review">
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
                      {t(tab.labelKey)} <span className="ml-1 text-xs text-gray-400">{tabCounts[tab.key]}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {selectedRecords.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">{t("teacherHomework.noStudentsInTab")}</p>
                  ) : selectedRecords.map(({ item, submission, status, method }) => {
                    const draft = drafts[item.studentId] || { score: "", maxScore: "", teacherRemark: "" };
                    const savingRow = rowSavingId === item.studentId;
                    return (
                      <div key={item.id} className="rounded-lg border border-gray-100 p-3 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{item.student.name}</p>
                            <p className="text-xs text-gray-400">{t("teacherHomework.rollLabel", { roll: item.student.rollNo })}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[status])}>{academicLabel(status)}</Badge>
                            <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">{method}</Badge>
                          </div>
                        </div>

                        <div className="grid gap-3 text-xs text-gray-500 md:grid-cols-3">
                          <div><span className="font-medium text-gray-700">{t("teacherHomework.submittedLabel")}</span> {formatDate(submission?.submittedAt ?? item.submittedAt)}</div>
                          <div><span className="font-medium text-gray-700">{t("teacherHomework.checkedLabel")}</span> {formatDate(submission?.checkedAt ?? item.checkedAt)}</div>
                          <div>
                            {submission?.attachmentUrl ? (
                              <a href={submission.attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700">
                                <ExternalLink className="w-3 h-3" /> {submission.fileName || t("teacherHomework.attachment")}
                              </a>
                            ) : (
                              <span className="text-gray-400">{t("teacherHomework.noAttachment")}</span>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-[90px_90px_1fr_auto] md:items-center">
                          <Input
                            type="number"
                            min={0}
                            placeholder={t("teacherHomework.scorePlaceholder")}
                            value={draft.score}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, score: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <Input
                            type="number"
                            min={0}
                            placeholder={t("teacherHomework.maxPlaceholder")}
                            value={draft.maxScore}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, maxScore: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <Input
                            placeholder={t("teacherHomework.remarkPlaceholder")}
                            value={draft.teacherRemark}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.studentId]: { ...draft, teacherRemark: e.target.value } }))}
                            disabled={!canEdit || savingRow}
                          />
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => saveStudentStatus(item, "SUBMITTED")} disabled={!canEdit || method === "ONLINE" || savingRow} className="gap-1">
                              <FileCheck2 className="w-3.5 h-3.5" /> {t("teacherHomework.physical")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => saveStudentStatus(item, "NOT_SUBMITTED")} disabled={!canEdit || !afterDeadline || savingRow}>
                              {t("teacherHomework.notSubmitted")}
                            </Button>
                            {submission?.submissionMethod === "ONLINE" ? (
                              <>
                                <Button size="sm" onClick={() => saveOnlineReview(submission, "REVIEWED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> {t("teacherHomework.check")}
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => saveOnlineReview(submission, "REJECTED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <XCircle className="w-3.5 h-3.5" /> {t("teacherHomework.reject")}
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" onClick={() => saveStudentStatus(item, "CHECKED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <Save className="w-3.5 h-3.5" /> {t("teacherHomework.check")}
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => saveStudentStatus(item, "REJECTED")} disabled={!canEdit || savingRow} className="gap-1">
                                  <XCircle className="w-3.5 h-3.5" /> {t("teacherHomework.reject")}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

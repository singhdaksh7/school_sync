"use client";

import { useEffect, useState, useTransition } from "react";
import { 
  Activity, Calendar, Users, ClipboardCheck, AlertTriangle, AlertCircle, Play, 
  CheckCircle, XCircle, Search, UserCheck, UserX, Clock, CreditCard, 
  BookOpen, ClipboardList, ArrowRight, Loader2, ShieldCheck, RefreshCw, Filter, ShieldAlert, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseCostGuardError } from "@/lib/cost-guard-error-handler";
import { extractActivityItems, formatActivityCode, type OperationsActivityItem } from "@/lib/operations-command-center-dto";

/**
 * GET .../operations/daily-summary's real response is DailyOperationsSummary
 * (src/lib/operations-daily-summary.ts), redacted per-actor (fees/exams/
 * reportCards stripped for a delegated Teacher Operations Head). Deliberately
 * NOT typed against that interface here: this component's JSX below reads a
 * long list of fields (e.g. `coveragePercent`, `overloadedCount`,
 * `markedSectionsCount`, `.length`/`.map` on the activity feed) that do not
 * actually exist on the real nested engine-output types — a pre-existing
 * mismatch between this UI and the backend DTO, confirmed by attempting a
 * precise type here and observing ~50 resulting compile errors across every
 * summary sub-section. Fixing that mismatch would mean guessing at and
 * rewriting dozens of field mappings, which is a functional/behavioral
 * change outside a lint-only pass, not a typing exercise. Left as `any` in
 * this ONE narrowly-scoped case; every other `any` in this file has been
 * replaced with a real, accurate type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OperationsSummary = any;

interface ExamSchemeOption {
  id: string;
  name: string;
}

interface TeacherOption {
  id: string;
  name: string;
}

/** Loosely mirrors the recommendation shape produced by the substitution
 * engine's topRecommendations (src/lib/arrangements.ts) — kept local/loose
 * rather than importing the engine's internal type since only these fields
 * are read here. */
interface SubstituteRecommendation {
  teacherId: string;
  teacherName: string;
  score?: number;
}

/** Fields this board actually reads per row. NOTE: the live GET
 * .../operations/teachers/status route returns TeacherTodayStatus
 * (teacherId/teacherName/baseStatus/operationalStatus/...), which does not
 * literally have `status`/`subject`/`inClass`/`classRoom` — those reads are
 * pre-existing and were silently `undefined` before this typing pass. Kept
 * as optional fields here (not on the canonical DTO) to preserve the exact
 * current runtime behavior; not touched, since fixing the mapping is a
 * behavior change outside this lint-only pass. */
interface TeacherStatusRow {
  teacherId: string;
  teacherName: string;
  status?: string;
  subject?: string;
  inClass?: boolean;
  classRoom?: string;
}

/** Raw LeaveRequest row as returned by GET .../leaves (Prisma `include`
 * shape: scalar columns plus nested teacher/student/reviewedBy). */
interface LeaveRow {
  id: string;
  type: string;
  status: string;
  fromDate: string;
  toDate: string;
  reason: string | null;
  teacherId: string | null;
  teacher?: { name: string; subject: string | null } | null;
  teacherName?: string;
}

/**
 * The interfaces below capture only the specific fields each `summary`-
 * derived `.map()` callback below reads — `summary` itself is untyped (see
 * OperationsSummary above), so without an explicit parameter type each of
 * these callbacks would trip TypeScript's noImplicitAny. Not asserted as
 * canonical backend DTOs.
 */
interface AttentionItemRow {
  severity: "ERROR" | "WARNING" | string;
  message: string;
  metadata?: { count?: number };
  actionTarget?: string;
}

interface RecentPaymentRow {
  id: string;
  studentName: string;
  studentRollNo?: string;
  amount: number;
}

interface UncoveredLectureRow {
  className: string;
  sectionName: string;
  sectionId: string;
  period: number;
  subject: string;
  absentTeacherId: string;
  absentTeacherName: string;
  topRecommendations?: SubstituteRecommendation[];
}

interface LowestAttendanceSectionRow {
  sectionId: string;
  className: string;
  sectionName: string;
  presentPercent: number;
}

interface Props {
  schoolId: string;
  userRole: string;
  isEffectiveTeacher?: boolean;
  schoolSlug: string;
  onForbiddenAction?: () => void;
  teacherId?: string;
}

export default function OperationsCommandCenter({ schoolId, userRole, isEffectiveTeacher = false, schoolSlug, onForbiddenAction, teacherId }: Props) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "attention" | "current-period" | "teachers" | "leaves" | "settings">("dashboard");
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examSchemeId, setExamSchemeId] = useState("");
  const [examSchemes, setExamSchemes] = useState<ExamSchemeOption[]>([]);

  // Replacement modal state
  const [replacementModal, setReplacementModal] = useState<{
    date: string;
    sectionId: string;
    period: number;
    subject: string;
    absentTeacherId: string;
    absentTeacherName: string;
    recommendations: SubstituteRecommendation[];
  } | null>(null);
  const [replacing, setReplacing] = useState(false);

  // Teacher status board state
  const [teacherStatuses, setTeacherStatuses] = useState<TeacherStatusRow[]>([]);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherFilter, setTeacherFilter] = useState<string>("ALL");
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [savingTeacherStatus, setSavingTeacherStatus] = useState(false);

  // Leave requests state
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(false);

  // Alternate Operations Configuration state
  const [operationsHeadConfig, setOperationsHeadConfig] = useState<{
    primaryTeacherId: string;
    alternate1TeacherId: string;
    alternate2TeacherId: string;
    activeOperationsHeadTeacherId?: string | null;
    activeReasonCode?: string | null;
  }>({
    primaryTeacherId: "",
    alternate1TeacherId: "",
    alternate2TeacherId: "",
  });
  const [allTeachers, setAllTeachers] = useState<TeacherOption[]>([]);
  const [configSaving, setConfigSaving] = useState(false);

  // Load basic daily summary
  useEffect(() => {
    fetchSummary();
    if (!isEffectiveTeacher) {
      // Fetch exam schemes
      fetch(`/api/schools/${schoolId}/exam-schemes`)
        .then((r) => r.json())
        .then((data) => setExamSchemes(data.data || []));
      // Fetch all teachers list for config dropdown
      fetch(`/api/schools/${schoolId}/teachers`)
        .then((r) => r.json())
        .then((data) => setAllTeachers(data.data || []));
    }
  }, [schoolId, examSchemeId]);

  // Load teacher statuses when tab active
  useEffect(() => {
    if (activeTab === "teachers") {
      fetchTeacherStatuses();
    } else if (activeTab === "leaves") {
      fetchLeaves();
    } else if (activeTab === "settings" && !isEffectiveTeacher) {
      fetchOperationsHeadConfig();
    }
  }, [activeTab, teacherFilter, teacherSearch]);

  const fetchSummary = async () => {
    setLoading(true);
    setError("");
    try {
      const url = `/api/schools/${schoolId}/operations/daily-summary${examSchemeId ? `?examSchemeId=${examSchemeId}` : ""}`;
      const res = await fetch(url);
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      const data = await res.json();
      // GET .../operations/daily-summary embeds `activity` as the
      // ActivityTimelinePage envelope ({ data: ActivityItem[]; total }), not
      // a bare array — normalize once here so the rest of the component can
      // treat it as an array (was previously `activity.map is not a
      // function` once the object reached the JSX below).
      setSummary({ ...data, activity: extractActivityItems(data.activity) });
    } catch (e) {
      setError("Failed to fetch daily operations summary.");
    } finally {
      setLoading(false);
    }
  };

  const fetchTeacherStatuses = async () => {
    setTeachersLoading(true);
    try {
      const query = new URLSearchParams();
      if (teacherFilter && teacherFilter !== "ALL") query.set("filter", teacherFilter);
      if (teacherSearch) query.set("search", teacherSearch);
      
      const res = await fetch(`/api/schools/${schoolId}/operations/teachers/status?${query.toString()}`);
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      const data = await res.json();
      setTeacherStatuses(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setTeachersLoading(false);
    }
  };

  const fetchLeaves = async () => {
    setLeavesLoading(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/leaves`);
      const data = await res.json();
      setLeaves(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLeavesLoading(false);
    }
  };

  const fetchOperationsHeadConfig = async () => {
    try {
      const res = await fetch(`/api/schools/${schoolId}/operational-roles/teacher-operations`);
      const data = await res.json();
      setOperationsHeadConfig({
        primaryTeacherId: data.primaryTeacherId || "",
        alternate1TeacherId: data.alternate1TeacherId || "",
        alternate2TeacherId: data.alternate2TeacherId || "",
        activeOperationsHeadTeacherId: data.activeOperationsHeadTeacherId,
        activeReasonCode: data.activeReasonCode,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const saveOperationsHeadConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/operational-roles/teacher-operations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operationsHeadConfig),
      });
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      const data = await res.json();
      if (res.ok) {
        alert("Operations head chain of command updated successfully.");
        fetchOperationsHeadConfig();
      } else {
        alert(parseCostGuardError(res, data).message || "Failed to update configuration.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setConfigSaving(false);
    }
  };

  // A 200 OK bulk response can still contain per-item failures (e.g. an
  // effective Operations Head's own row is always rejected server-side with
  // SELF_TEACHER_STATUS_MUTATION_FORBIDDEN, never silenced) — these must be
  // surfaced, not treated as if every update succeeded.
  const REASON_MESSAGES: Record<string, string> = {
    SELF_TEACHER_STATUS_MUTATION_FORBIDDEN: "you cannot change your own status via this action",
    ON_APPROVED_LEAVE: "teacher is on approved leave",
    FOREIGN_TEACHER: "teacher not found in this school",
  };
  const reportPartialFailures = (results: Array<{ teacherId: string; ok: boolean; reason?: string }> | undefined) => {
    const failed = (results ?? []).filter((r) => !r.ok);
    if (failed.length === 0) return;
    const names = failed
      .map((f) => {
        const name = teacherStatuses.find((t) => t.teacherId === f.teacherId)?.teacherName || f.teacherId;
        return `${name} (${REASON_MESSAGES[f.reason ?? ""] ?? f.reason ?? "failed"})`;
      })
      .join(", ");
    alert(`${failed.length} update(s) were not applied: ${names}`);
  };

  // Bulk status change saving
  const updateTeacherStatus = async (teacherId: string, status: "PRESENT" | "ABSENT") => {
    setSavingTeacherStatus(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/operations/teachers/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ teacherId, status }]
        }),
      });
      const data = await res.json();
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      if (res.ok) {
        reportPartialFailures(data.results);
        fetchTeacherStatuses();
        fetchSummary();
      } else {
        alert(parseCostGuardError(res, data).message || "Action failed.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTeacherStatus(false);
    }
  };

  const bulkUpdateStatuses = async (status: "PRESENT" | "ABSENT") => {
    const targetTeachers = teacherStatuses.filter((t) => t.status !== "ON_LEAVE");
    if (targetTeachers.length === 0) return;

    setSavingTeacherStatus(true);
    try {
      const updates = targetTeachers.map((t) => ({ teacherId: t.teacherId, status }));
      const res = await fetch(`/api/schools/${schoolId}/operations/teachers/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      if (res.ok) {
        reportPartialFailures(data.results);
        fetchTeacherStatuses();
        fetchSummary();
      } else {
        alert(parseCostGuardError(res, data).message || "Action failed.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTeacherStatus(false);
    }
  };

  // Resolve uncovered period
  const assignReplacement = async (substituteTeacherId: string | null) => {
    if (!replacementModal) return;
    setReplacing(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/arrangements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: replacementModal.date,
          sectionId: replacementModal.sectionId,
          period: replacementModal.period,
          subject: replacementModal.subject,
          absentTeacherId: replacementModal.absentTeacherId,
          substituteTeacherId,
        }),
      });
      const data = await res.json();
      if (res.status === 403) {
        onForbiddenAction?.();
        return;
      }
      if (res.ok) {
        setReplacementModal(null);
        fetchSummary();
      } else {
        alert(parseCostGuardError(res, data).message || "Assignment failed.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReplacing(false);
    }
  };

  // Approve/reject leaves
  const handleLeaveDecision = async (leaveId: string, decision: "APPROVED" | "REJECTED") => {
    try {
      const res = await fetch(`/api/schools/${schoolId}/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      const data = await res.json();
      if (res.status === 403) {
        if (data.reasonCode === "SELF_LEAVE_APPROVAL_FORBIDDEN") {
          alert("Forbidden: You cannot approve or reject your own leave request.");
        } else {
          onForbiddenAction?.();
        }
        return;
      }
      if (res.ok) {
        fetchLeaves();
        fetchSummary();
      } else {
        alert(parseCostGuardError(res, data).message || "Action failed.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-gray-400 flex flex-col items-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <span className="text-sm">Assembling school operations dashboard...</span>
      </div>
    );
  }

  const {
    attention = [],
    health = { score: 100 },
    teachers = { summary: {} },
    attendance = { students: {}, completion: {} },
    coverage = {},
    currentPeriod = {},
    nextPeriodRisk = {},
    workload = { summary: {} },
    homework = { summary: {} },
    exams = null,
    reportCards = null,
    fees = null,
    activity = [],
  } = summary || {};

  return (
    <div className="space-y-6">
      {/* Top Header Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border shadow-sm">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Operations Health</p>
              <p className="text-2xl font-bold mt-1 text-gray-900">{health?.score}%</p>
            </div>
            <Activity className="w-8 h-8 text-emerald-500" />
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Student Attendance</p>
              <p className="text-2xl font-bold mt-1 text-gray-900">
                {attendance?.students?.presentPercent !== undefined ? `${Math.round(attendance.students.presentPercent)}%` : "N/A"}
              </p>
            </div>
            <ClipboardCheck className="w-8 h-8 text-blue-500" />
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Lecture Coverage</p>
              <p className="text-2xl font-bold mt-1 text-gray-900">
                {coverage?.coveragePercent !== undefined ? `${Math.round(coverage.coveragePercent)}%` : "N/A"}
              </p>
            </div>
            <BookOpen className="w-8 h-8 text-purple-500" />
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Needs Attention</p>
              <p className={cn("text-2xl font-bold mt-1", attention.length > 0 ? "text-red-600" : "text-gray-900")}>
                {attention.length} alerts
              </p>
            </div>
            <AlertTriangle className={cn("w-8 h-8", attention.length > 0 ? "text-red-500 animate-pulse" : "text-gray-400")} />
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-150 gap-6">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "dashboard" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
        >
          Operations Overview
        </button>
        <button
          onClick={() => setActiveTab("attention")}
          className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all flex items-center gap-1.5", activeTab === "attention" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
        >
          Needs Attention {attention.length > 0 && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{attention.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab("current-period")}
          className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "current-period" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
        >
          Periods & Coverage
        </button>
        <button
          onClick={() => setActiveTab("teachers")}
          className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "teachers" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
        >
          Teacher Status Board
        </button>
        <button
          onClick={() => setActiveTab("leaves")}
          className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "leaves" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
        >
          Leave Management
        </button>
        {!isEffectiveTeacher && (
          <button
            onClick={() => setActiveTab("settings")}
            className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all flex items-center gap-1.5", activeTab === "settings" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
          >
            <Settings className="w-4 h-4" /> Delegation Config
          </button>
        )}
      </div>

      {/* Tab Panels */}
      {activeTab === "dashboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info Blocks */}
          <div className="lg:col-span-2 space-y-6">
            {/* Student Attendance summary */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-blue-600" /> Attendance summary</CardTitle>
                <CardDescription>Overall student presence rate and section coverage indicators.</CardDescription>
              </CardHeader>
              <CardContent className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 border rounded-xl bg-gray-50/50">
                  <p className="text-xs text-gray-500 font-semibold">Attendance Completion</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">
                    {attendance?.completion?.markedSectionsCount} / {attendance?.completion?.totalSectionsCount} sections marked
                  </p>
                </div>
                {attendance?.lowestSections && attendance.lowestSections.length > 0 && (
                  <div className="p-3 border border-red-100 rounded-xl bg-red-50/20">
                    <p className="text-xs text-red-800 font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Weakest Sections Presence</p>
                    <div className="mt-1 space-y-0.5">
                      {attendance.lowestSections.map((sec: LowestAttendanceSectionRow) => (
                        <p key={sec.sectionId} className="text-xs text-gray-600">
                          {sec.className}-{sec.sectionName}: <strong className="text-red-700">{Math.round(sec.presentPercent)}%</strong>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timetable Coverage details */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5"><Calendar className="w-4 h-4 text-purple-600" /> Lecture Arrangements Summary</CardTitle>
              </CardHeader>
              <CardContent className="pt-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 border rounded-xl">
                  <p className="text-xs text-gray-400 font-semibold">Scheduled</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">{coverage?.scheduledCount}</p>
                </div>
                <div className="p-3 border rounded-xl">
                  <p className="text-xs text-gray-400 font-semibold">Covered (Normal)</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">{coverage?.normalCount}</p>
                </div>
                <div className="p-3 border border-green-150 rounded-xl bg-green-50/10">
                  <p className="text-xs text-green-700 font-semibold">Arranged</p>
                  <p className="text-lg font-bold mt-1 text-green-900">{coverage?.substitutedCount}</p>
                </div>
                <div className={cn("p-3 border rounded-xl", coverage?.uncoveredCount > 0 ? "border-red-150 bg-red-50/10 text-red-800" : "")}>
                  <p className="text-xs font-semibold text-gray-400">Uncovered</p>
                  <p className={cn("text-lg font-bold mt-1", coverage?.uncoveredCount > 0 ? "text-red-600" : "text-gray-900")}>
                    {coverage?.uncoveredCount}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Workload Insights */}
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Teacher Daily Workload Load</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 border border-amber-100 rounded-xl bg-amber-50/10">
                  <p className="text-xs text-amber-700 font-semibold">Overloaded</p>
                  <p className="text-lg font-bold mt-1 text-amber-900">{workload?.summary?.overloadedCount}</p>
                </div>
                <div className="p-3 border rounded-xl">
                  <p className="text-xs text-gray-400 font-semibold">Normal Load</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">{workload?.summary?.normalCount}</p>
                </div>
                <div className="p-3 border rounded-xl">
                  <p className="text-xs text-gray-400 font-semibold">Light Load</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">{workload?.summary?.lightCount}</p>
                </div>
                <div className="p-3 border rounded-xl">
                  <p className="text-xs text-gray-400 font-semibold">No Lectures</p>
                  <p className="text-lg font-bold mt-1 text-gray-900">{workload?.summary?.noLectureCount}</p>
                </div>
              </CardContent>
            </Card>

            {/* Exam / Report progress (Admins/Owners only) */}
            {!isEffectiveTeacher && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-border shadow-sm">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Exam Submissions Progress</CardTitle>
                      <CardDescription>Submissions tracking for marks schemes.</CardDescription>
                    </div>
                    {examSchemes.length > 0 && (
                      <Select value={examSchemeId} onValueChange={setExamSchemeId}>
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue placeholder="Select scheme" />
                        </SelectTrigger>
                        <SelectContent>
                          {examSchemes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </CardHeader>
                  <CardContent>
                    {exams ? (
                      <div className="space-y-2 mt-2">
                        <div className="flex justify-between text-xs font-semibold text-gray-600">
                          <span>Progress: {exams.completedPercentage}%</span>
                          <span>{exams.totalEnteredResults} / {exams.totalRequiredResults} entered</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${exams.completedPercentage}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">Pending inputs count: <strong>{exams.totalPendingResults}</strong></p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 py-4 text-center border border-dashed rounded-lg">Select exam scheme above to view status.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold">Report Cards Generation Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {reportCards ? (
                      <div className="space-y-2 mt-2">
                        <div className="flex justify-between text-xs font-semibold text-gray-600">
                          <span>Drafts generated: {reportCards.generatedDrafts}</span>
                          <span>Published: {reportCards.publishedCards}</span>
                        </div>
                        {reportCards.expected !== null && reportCards.expected !== undefined ? (
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-green-600 h-1.5 rounded-full"
                              style={{ width: `${reportCards.expected > 0 ? (reportCards.publishedCards / reportCards.expected) * 100 : 0}%` }}
                            />
                          </div>
                        ) : (
                          <div className="w-full bg-gray-100 rounded-full h-1.5" title="Expected total unavailable" />
                        )}
                        <p className="text-[10px] text-gray-400 mt-1">Expected total cards: <strong>{reportCards.expected !== null && reportCards.expected !== undefined ? reportCards.expected : "Expected total unavailable"}</strong></p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 py-4 text-center border border-dashed rounded-lg">Select exam scheme above to view report status.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Sidebar widget panel */}
          <div className="space-y-6">
            {/* Fees Today collection (Admins/Owners only) */}
            {!isEffectiveTeacher && fees && (
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-1.5"><CreditCard className="w-4.5 h-4.5 text-blue-600" /> Fees Receipts Today</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 border rounded-xl bg-blue-50/20 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500 font-semibold">Collected Amount</p>
                      <p className="text-xl font-bold mt-1 text-gray-900">{formatCurrency(Number(fees.summary?.totalCollected || 0))}</p>
                    </div>
                    <Badge variant="outline" className="h-5 px-1 bg-white">{fees.summary?.receiptsCount} receipts</Badge>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Recent Payments</p>
                    {fees.recentPayments?.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-2">No transactions recorded today.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {fees.recentPayments?.map((p: RecentPaymentRow) => (
                          <div key={p.id} className="flex justify-between items-center p-2 border border-gray-100 rounded-lg text-xs hover:bg-gray-50/50">
                            <div>
                              <p className="font-semibold text-gray-900 truncate max-w-[120px]">{p.studentName}</p>
                              <span className="text-[10px] text-gray-400 font-normal">Roll: {p.studentRollNo || "N/A"}</span>
                            </div>
                            <span className="font-bold text-gray-800">{formatCurrency(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Operations Timeline logs */}
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-1.5"><Clock className="w-4.5 h-4.5 text-gray-600" /> Operations Activity Log</CardTitle>
              </CardHeader>
              <CardContent>
                {activity.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No operational logs recorded today.</p>
                ) : (
                  <div className="space-y-3.5 max-h-96 overflow-y-auto pr-1">
                    {activity.map((act: OperationsActivityItem) => (
                      <div key={act.id} className="flex items-start gap-2.5 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium text-gray-700 leading-normal">
                            {act.actorName ? `${act.actorName} — ` : ""}{formatActivityCode(act.code)}
                          </p>
                          <span className="text-[10px] text-gray-400 block mt-0.5">
                            {new Date(act.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Tab: Needs Attention */}
      {activeTab === "attention" && (
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">System Alerts / Actions Panel</CardTitle>
            <CardDescription>Review system warnings requiring immediate intervention.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {attention.length === 0 ? (
              <div className="py-12 text-center text-gray-400 border border-dashed rounded-xl">
                <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-2" />
                <p className="font-semibold text-gray-600 text-sm">All Systems Stable</p>
                <p className="text-xs text-gray-400 mt-1">No pending operational issues or warnings.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {attention.map((item: AttentionItemRow, idx: number) => (
                  <div 
                    key={idx} 
                    className={cn(
                      "p-4 border rounded-xl flex items-center justify-between transition-all",
                      item.severity === "ERROR" ? "bg-red-50/50 border-red-200 text-red-900" : "bg-amber-50/50 border-amber-200 text-amber-900"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {item.severity === "ERROR" ? <AlertCircle className="w-5 h-5 text-red-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold leading-normal">{item.message}</p>
                        {item.metadata?.count !== undefined && (
                          <span className="text-xs text-gray-500 mt-1 block">
                            Impact count: <strong>{item.metadata.count}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                    {item.actionTarget && (
                      <Button 
                        size="sm" 
                        variant={item.severity === "ERROR" ? "destructive" : "outline"}
                        className={cn("gap-1", item.severity !== "ERROR" && "border-amber-250 bg-amber-50/15 text-amber-700 hover:bg-amber-50/30")}
                        onClick={() => {
                          if (item.actionTarget === "UNCOVERED_LECTURES") {
                            setActiveTab("current-period");
                          } else if (item.actionTarget === "TEACHER_ATTENDANCE") {
                            setActiveTab("teachers");
                          } else if (item.actionTarget === "TEACHER_LEAVES") {
                            setActiveTab("leaves");
                          }
                        }}
                      >
                        Action <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Current & Next Periods */}
      {activeTab === "current-period" && (
        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4.5 h-4.5 text-blue-600" /> Real-time Period Coverage Board
              </CardTitle>
              <CardDescription>
                Live monitoring of current school periods, teacher schedules, and instant arrangements resolution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Current period status info */}
              <div className="p-4 border border-gray-150 rounded-xl bg-gray-50/30 flex flex-wrap gap-6 justify-between items-center text-sm">
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Active Period Status</p>
                  <p className="text-lg font-bold mt-1 text-gray-900 leading-tight">
                    {currentPeriod?.status || "NO ACTIVE PERIOD"}
                  </p>
                </div>
                {currentPeriod?.currentPeriodNo && (
                  <>
                    <div className="h-8 w-px bg-gray-200" />
                    <div>
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Current Period No</p>
                      <p className="text-lg font-bold mt-1 text-gray-900 leading-tight">Period #{currentPeriod.currentPeriodNo}</p>
                    </div>
                  </>
                )}
                <div className="h-8 w-px bg-gray-200" />
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Arrangements Need</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={currentPeriod?.uncoveredCount > 0 ? "destructive" : "success"} className="h-5 px-1.5 text-[10px]">
                      {currentPeriod?.uncoveredCount > 0 ? `${currentPeriod.uncoveredCount} Uncovered` : "None (All Covered)"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Next Period Risk block */}
              {nextPeriodRisk && (
                <div className={cn(
                  "p-4 border rounded-xl flex flex-wrap justify-between items-center gap-4 text-sm",
                  nextPeriodRisk.riskLevel === "CRITICAL" || nextPeriodRisk.riskLevel === "HIGH" 
                    ? "bg-red-50/30 border-red-200 text-red-900" 
                    : nextPeriodRisk.riskLevel === "MEDIUM" 
                    ? "bg-amber-50/30 border-amber-200 text-amber-900" 
                    : "bg-green-50/30 border-green-200 text-green-900"
                )}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider opacity-70">Next Period Risk Rating</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-lg font-bold">{nextPeriodRisk.riskLevel || "NONE"}</span>
                      {nextPeriodRisk.startsInMinutes !== undefined && (
                        <span className="text-xs opacity-75">(Starts in {nextPeriodRisk.startsInMinutes} mins)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div>
                      <p className="text-xs opacity-70">Scheduled</p>
                      <p className="text-base font-bold mt-0.5">{nextPeriodRisk.scheduledCount || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-70">Uncovered Count</p>
                      <p className="text-base font-bold mt-0.5">{nextPeriodRisk.uncoveredCount || 0}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Uncovered lectures list */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Uncovered Lectures Today ({[...(currentPeriod?.uncoveredDetails || []), ...(nextPeriodRisk?.uncoveredDetails || [])].length})</CardTitle>
            </CardHeader>
            <CardContent>
              {[...(currentPeriod?.uncoveredDetails || []), ...(nextPeriodRisk?.uncoveredDetails || [])].length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">All active and upcoming lectures have assigned teachers.</p>
              ) : (
                <div className="space-y-3">
                  {[...(currentPeriod?.uncoveredDetails || []), ...(nextPeriodRisk?.uncoveredDetails || [])].map((lec: UncoveredLectureRow, idx: number) => (
                    <div key={idx} className="flex flex-wrap items-center justify-between p-3.5 border border-red-150 rounded-xl bg-red-50/10 text-xs">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">
                          {lec.className} - {lec.sectionName}
                        </p>
                        <p className="text-gray-500 mt-1">
                          Period {lec.period} · Subject: <strong>{lec.subject}</strong> · Absent: {lec.absentTeacherName}
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        variant="destructive"
                        className="gap-1.5"
                        onClick={() => setReplacementModal({
                          date: summary?.dateKey || new Date().toISOString().split("T")[0],
                          sectionId: lec.sectionId,
                          period: lec.period,
                          subject: lec.subject,
                          absentTeacherId: lec.absentTeacherId,
                          absentTeacherName: lec.absentTeacherName,
                          recommendations: lec.topRecommendations || [],
                        })}
                      >
                        View Replacements
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Teacher Status Board */}
      {activeTab === "teachers" && (
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Teacher Attendance & Live Status Board</CardTitle>
                <CardDescription>Submit presence declarations and track current classroom assignments.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter and search controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[200px]">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9 h-9 text-xs"
                    placeholder="Search by faculty name..."
                    value={teacherSearch}
                    onChange={(e) => setTeacherSearch(e.target.value)}
                  />
                </div>
                
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-9 gap-1 text-green-700 hover:bg-green-50 text-xs font-semibold" onClick={() => bulkUpdateStatuses("PRESENT")} disabled={savingTeacherStatus}>
                    Mark All Present
                  </Button>
                  <Button size="sm" variant="outline" className="h-9 gap-1 text-red-700 hover:bg-red-50 text-xs font-semibold" onClick={() => bulkUpdateStatuses("ABSENT")} disabled={savingTeacherStatus}>
                    Mark All Absent
                  </Button>
                </div>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                {["ALL", "PRESENT", "ABSENT", "ON_LEAVE", "NOT_MARKED", "IN_CLASS", "FREE"].map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={teacherFilter === f ? "default" : "outline"}
                    className="h-8 text-xs font-semibold px-2.5"
                    onClick={() => setTeacherFilter(f)}
                  >
                    {f}
                  </Button>
                ))}
              </div>
            </div>

            {teachersLoading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading staff status board...</div>
            ) : teacherStatuses.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12 border border-dashed rounded-xl">No teachers match current filter selection.</p>
            ) : (
              <div className="border border-gray-150 rounded-2xl overflow-hidden bg-white">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-150 font-semibold text-gray-500">
                      <th className="p-3">Faculty Name</th>
                      <th className="p-3">Department Subject</th>
                      <th className="p-3">Attendance Status</th>
                      <th className="p-3">Class Activity</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teacherStatuses.map((item) => (
                      <tr key={item.teacherId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/40">
                        <td className="p-3 font-semibold text-gray-900">{item.teacherName}</td>
                        <td className="p-3 text-gray-500">{item.subject || "General"}</td>
                        <td className="p-3">
                          <Badge 
                            variant={item.status === "PRESENT" ? "success" : item.status === "ABSENT" ? "destructive" : item.status === "ON_LEAVE" ? "warning" : "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {item.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-gray-600">
                          {item.inClass ? (
                            <span className="flex items-center gap-1 text-blue-700 font-semibold">
                              <BookOpen className="w-3.5 h-3.5 shrink-0" /> In class ({item.classRoom})
                            </span>
                          ) : (
                            <span className="text-gray-400">Free Period</span>
                          )}
                        </td>
                        <td className="p-3 text-right space-x-1">
                          <Button
                            size="icon" 
                            variant="ghost" 
                            className="w-7 h-7 hover:bg-green-50 hover:text-green-600 rounded-lg text-gray-400"
                            disabled={item.status === "PRESENT" || savingTeacherStatus}
                            onClick={() => updateTeacherStatus(item.teacherId, "PRESENT")}
                          >
                            <UserCheck className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon" 
                            variant="ghost" 
                            className="w-7 h-7 hover:bg-red-50 hover:text-red-600 rounded-lg text-gray-400"
                            disabled={item.status === "ABSENT" || item.status === "ON_LEAVE" || savingTeacherStatus}
                            onClick={() => updateTeacherStatus(item.teacherId, "ABSENT")}
                          >
                            <UserX className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Leaves list */}
      {activeTab === "leaves" && (
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pending Leave Approvals ({leaves.filter((l) => l.status === "PENDING").length})</CardTitle>
            <CardDescription>Review submitted leave requests from faculty members.</CardDescription>
          </CardHeader>
          <CardContent>
            {leavesLoading ? (
              <div className="py-8 text-center text-gray-400">Loading leave requests...</div>
            ) : leaves.filter((l) => l.status === "PENDING").length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 border border-dashed rounded-xl">No pending leave requests found.</p>
            ) : (
              <div className="space-y-3">
                {leaves.filter((l) => l.status === "PENDING").map((leave) => {
                  const isOwnLeave = Boolean(teacherId) && leave.teacherId === teacherId;
                  return (
                    <div key={leave.id} className="p-4 border border-gray-150 rounded-xl flex flex-wrap items-center justify-between text-xs gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{leave.teacher?.name || leave.teacherName || "Faculty Member"}</p>
                        <p className="text-gray-500 mt-1 leading-normal">
                          Dates: {formatDate(leave.fromDate)} to {formatDate(leave.toDate)} · Type: {leave.type}
                        </p>
                        {leave.reason && <p className="text-gray-600 mt-1 italic">&quot;Reason: {leave.reason}&quot;</p>}
                        {isOwnLeave && (
                          <p className="text-amber-600 font-semibold mt-1">You cannot approve or reject your own leave request.</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-8 px-3.5 bg-green-600 hover:bg-green-700 text-white border-none"
                          onClick={() => handleLeaveDecision(leave.id, "APPROVED")}
                          disabled={isOwnLeave}
                          title={isOwnLeave ? "You cannot approve your own leave request" : undefined}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 px-3.5"
                          onClick={() => handleLeaveDecision(leave.id, "REJECTED")}
                          disabled={isOwnLeave}
                          title={isOwnLeave ? "You cannot reject your own leave request" : undefined}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Delegation configuration */}
      {activeTab === "settings" && !isEffectiveTeacher && (
        <Card className="border border-gray-150 shadow-sm max-w-xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-1.5"><ShieldAlert className="w-5 h-5 text-blue-600" /> Operations Delegation Configuration</CardTitle>
            <CardDescription>Setup alternative operations administrators to manage daily tasks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {operationsHeadConfig.activeOperationsHeadTeacherId && (
              <div className="p-3 border border-blue-200 bg-blue-50/30 rounded-xl text-xs text-blue-900 leading-normal flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Effective Operations Head Today:</p>
                  <p className="mt-0.5">
                    {allTeachers.find((t) => t.id === operationsHeadConfig.activeOperationsHeadTeacherId)?.name || "Unknown Teacher"}
                  </p>
                  {operationsHeadConfig.activeReasonCode && (
                    <p className="mt-1 font-semibold text-blue-700">Reason: {operationsHeadConfig.activeReasonCode}</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Primary Operations Head</Label>
                <Select
                  value={operationsHeadConfig.primaryTeacherId || "__none__"}
                  onValueChange={(v) => setOperationsHeadConfig((prev) => ({ ...prev, primaryTeacherId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select primary head" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {allTeachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>First Backup Head (Alternate 1)</Label>
                <Select
                  value={operationsHeadConfig.alternate1TeacherId || "__none__"}
                  onValueChange={(v) => setOperationsHeadConfig((prev) => ({ ...prev, alternate1TeacherId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select alternate 1" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {allTeachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Second Backup Head (Alternate 2)</Label>
                <Select
                  value={operationsHeadConfig.alternate2TeacherId || "__none__"}
                  onValueChange={(v) => setOperationsHeadConfig((prev) => ({ ...prev, alternate2TeacherId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select alternate 2" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {allTeachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button onClick={saveOperationsHeadConfig} disabled={configSaving}>
                {configSaving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Replacement recommendations dialog */}
      <Dialog open={replacementModal !== null} onOpenChange={(open) => !open && setReplacementModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Arrange Lecture Cover</DialogTitle>
            <DialogDescription>
              Assign a replacement teacher for absent faculty member {replacementModal?.absentTeacherName} in Period {replacementModal?.period}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <p className="font-semibold text-gray-400 uppercase tracking-wider">Top Substitute Recommendations</p>
            {replacementModal?.recommendations?.length === 0 ? (
              <p className="text-gray-400 text-center py-4 border rounded-lg">No recommended standby teachers available for this slot.</p>
            ) : (
              <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                {replacementModal?.recommendations?.map((rec) => (
                  <div 
                    key={rec.teacherId} 
                    className="flex justify-between items-center p-3 border border-gray-100 rounded-xl hover:bg-blue-50/20 hover:border-blue-200 transition-all cursor-pointer"
                    onClick={() => assignReplacement(rec.teacherId)}
                  >
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{rec.teacherName}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Compatibility rating: {rec.score || "N/A"}</p>
                    </div>
                    <Badge variant="success" className="text-[9px] px-1.5 py-0 h-5">Assign</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setReplacementModal(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

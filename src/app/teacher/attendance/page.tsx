"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Save, Check, X, Clock, ClipboardCheck, Lock, CalendarClock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTeacherPermissions } from "@/hooks/useTeacherPermissions";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Status = "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
type SessionStatus = "DRAFT" | "SUBMITTED";

interface Student { id: string; name: string; rollNo: string }
interface TeacherProfile {
  id: string;
  name: string;
  school: { name: string };
  mentorSection: {
    id: string;
    name: string;
    class: { name: string };
    students: Student[];
  } | null;
}
interface TeacherSelfAttendance {
  date: string;
  cutoffTime: string;
  cutoffPassed: boolean;
  canMarkPresent: boolean;
  attendance: { id: string; status: "PRESENT" | "ABSENT" | "LATE"; createdAt: string } | null;
}
interface RosterEntry { studentId: string; status: Status | null; suggested: boolean }
interface RosterView { sessionStatus: SessionStatus; submittedAt: string | null; submittedById: string | null; roster: RosterEntry[] }
interface CorrectionItem { studentId: string; originalStatus: Status; requestedStatus: Status; student?: { name: string; rollNo: string } }
interface CorrectionRequest {
  id: string;
  date: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  items: CorrectionItem[];
}

const statusConfig: Record<Status, { labelKey: string; icon: typeof Check; color: string }> = {
  PRESENT: { labelKey: "common.present", icon: Check, color: "bg-green-100 text-green-700 border-green-300" },
  ABSENT: { labelKey: "common.absent", icon: X, color: "bg-red-100 text-red-700 border-red-300" },
  LATE: { labelKey: "common.late", icon: Clock, color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  ON_LEAVE: { labelKey: "teacherAttendance.onLeave", icon: CalendarClock, color: "bg-blue-100 text-blue-700 border-blue-300" },
};

const correctionStatusVariant: Record<CorrectionRequest["status"], "warning" | "success" | "destructive"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

export default function TeacherAttendancePage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [attendance, setAttendance] = useState<Record<string, Status>>({});
  const [suggested, setSuggested] = useState<Record<string, boolean>>({});
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("DRAFT");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selfAttendance, setSelfAttendance] = useState<TeacherSelfAttendance | null>(null);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfMarking, setSelfMarking] = useState(false);
  const [selfMessage, setSelfMessage] = useState("");
  const [selfError, setSelfError] = useState("");

  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionSelection, setCorrectionSelection] = useState<Record<string, Status>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);

  useEffect(() => {
    fetch("/api/teacher/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setProfileError(d.error);
        else setProfile(d);
      });
  }, []);

  const fetchSelfAttendance = useCallback(async () => {
    setSelfLoading(true);
    const res = await fetch("/api/teacher/attendance/today");
    const data = await res.json();
    setSelfLoading(false);
    if (res.ok) {
      setSelfAttendance(data);
      setSelfError("");
      return;
    }
    setSelfError(data.error || t("teacherAttendance.unableToLoadTodayAttendance"));
  }, [t]);
  useEffect(() => {
    const id = window.setTimeout(() => fetchSelfAttendance(), 0);
    return () => window.clearTimeout(id);
  }, [fetchSelfAttendance]);

  async function markSelfPresent() {
    setSelfMarking(true);
    setSelfMessage("");
    setSelfError("");
    const res = await fetch("/api/teacher/attendance/mark", { method: "POST" });
    const data = await res.json();
    setSelfMarking(false);
    if (res.ok) {
      setSelfMessage(t("teacherAttendance.markedPresentSuccess"));
      fetchSelfAttendance();
      return;
    }
    setSelfError(data.error || t("teacherAttendance.unableToMarkAttendance"));
  }

  const fetchAttendance = useCallback(async (d: string) => {
    setLoading(true);
    setSubmitError("");
    const res = await fetch(`/api/teacher/attendance?date=${d}`);
    if (res.ok) {
      const data = (await res.json()) as RosterView;
      const map: Record<string, Status> = {};
      const suggestedMap: Record<string, boolean> = {};
      data.roster.forEach((r) => {
        if (r.status) map[r.studentId] = r.status;
        suggestedMap[r.studentId] = r.suggested;
      });
      setAttendance(map);
      setSuggested(suggestedMap);
      setSessionStatus(data.sessionStatus);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!profile?.mentorSection) return;
    const id = window.setTimeout(() => fetchAttendance(date), 0);
    return () => window.clearTimeout(id);
  }, [date, profile?.mentorSection, fetchAttendance]);

  const fetchCorrections = useCallback(async () => {
    const res = await fetch("/api/teacher/attendance/corrections");
    if (res.ok) setCorrections(await res.json());
  }, []);
  useEffect(() => {
    if (sessionStatus !== "SUBMITTED") return;
    const id = window.setTimeout(() => fetchCorrections(), 0);
    return () => window.clearTimeout(id);
  }, [sessionStatus, date, fetchCorrections]);

  const locked = sessionStatus === "SUBMITTED";

  function setStatus(id: string, status: Status) {
    if (locked) return;
    setAttendance((prev) => ({ ...prev, [id]: status }));
    setSuggested((prev) => ({ ...prev, [id]: false }));
  }

  function markAll(status: Status) {
    if (locked) return;
    const map: Record<string, Status> = {};
    profile?.mentorSection?.students.forEach((s) => { map[s.id] = status; });
    setAttendance(map);
    setSuggested({});
  }

  const { has: hasPermission } = useTeacherPermissions();
  const canMarkAttendance = hasPermission("ATTENDANCE", "MARK");
  const canSubmitAttendance = hasPermission("ATTENDANCE", "SUBMIT");

  const students = profile?.mentorSection?.students ?? [];

  async function saveDraft() {
    if (!profile?.mentorSection || locked) return;
    const records = students.filter((s) => attendance[s.id]).map((s) => ({ id: s.id, status: attendance[s.id] }));
    setSaving(true);
    const res = await fetch("/api/teacher/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, records }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  async function submitAttendance() {
    if (!profile?.mentorSection) return;
    setSubmitting(true);
    setSubmitError("");
    const res = await fetch("/api/teacher/attendance/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const data = await res.json();
    setSubmitting(false);
    setConfirmingSubmit(false);
    if (!res.ok) {
      if (data.reasonCode === "INCOMPLETE_ROSTER") {
        setSubmitError(t("teacherAttendance.incompleteRoster", { count: data.missingStudentIds?.length ?? 0 }));
      } else {
        setSubmitError(data.error || t("teacherAttendance.submitFailed"));
      }
      return;
    }
    fetchAttendance(date);
  }

  function toggleCorrectionStudent(studentId: string, current: Status) {
    setCorrectionSelection((prev) => {
      const next = { ...prev };
      if (studentId in next) delete next[studentId];
      else next[studentId] = current;
      return next;
    });
  }

  function setCorrectionRequestedStatus(studentId: string, status: Status) {
    setCorrectionSelection((prev) => ({ ...prev, [studentId]: status }));
  }

  async function submitCorrection() {
    if (!correctionReason.trim()) { setCorrectionError(t("teacherAttendance.correctionReasonRequired")); return; }
    const items = Object.entries(correctionSelection).map(([studentId, requestedStatus]) => ({ studentId, requestedStatus }));
    if (items.length === 0) { setCorrectionError(t("teacherAttendance.correctionSelectStudent")); return; }

    setCorrectionSaving(true);
    setCorrectionError("");
    const res = await fetch("/api/teacher/attendance/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, reason: correctionReason, items }),
    });
    const data = await res.json();
    setCorrectionSaving(false);
    if (!res.ok) { setCorrectionError(data.error || t("teacherAttendance.correctionFailed")); return; }

    setCorrectionMode(false);
    setCorrectionSelection({});
    setCorrectionReason("");
    fetchCorrections();
  }

  const presentCount = students.filter((s) => attendance[s.id] === "PRESENT").length;
  const absentCount = students.filter((s) => attendance[s.id] === "ABSENT").length;
  const lateCount = students.filter((s) => attendance[s.id] === "LATE").length;
  const onLeaveCount = students.filter((s) => attendance[s.id] === "ON_LEAVE").length;
  const unmarkedCount = students.filter((s) => !attendance[s.id]).length;
  const selfStatus = selfAttendance?.attendance?.status;
  const selfStatusConfig = selfStatus ? statusConfig[selfStatus] : null;

  const todaysCorrections = useMemo(() => corrections.filter((c) => c.date.slice(0, 10) === date), [corrections, date]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {profileError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-red-600 font-medium">{profileError}</p>
            </CardContent>
          </Card>
        ) : !profile ? (
          <div className="text-center py-20 text-gray-400">{t("common.loading")}</div>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{t("teacherAttendance.myAttendanceToday")}</span>
                  {selfLoading ? (
                    <span className="text-xs text-gray-400">{t("common.loading")}</span>
                  ) : selfStatusConfig ? (
                    <span className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium", selfStatusConfig.color)}>
                      <selfStatusConfig.icon className="w-3 h-3" />
                      {t(selfStatusConfig.labelKey)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 italic">{t("teacherAttendance.notMarked")}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-700">
                      {t("teacherAttendance.cutoffTime", { time: selfAttendance?.cutoffTime ?? "09:30" })}
                    </p>
                    {selfAttendance?.cutoffPassed && !selfAttendance.attendance && (
                      <p className="text-sm text-red-600 mt-1">{t("teacherAttendance.cutoffPassedNote")}</p>
                    )}
                    {selfMessage && <p className="text-sm text-green-700 mt-1">{selfMessage}</p>}
                    {selfError && <p className="text-sm text-red-600 mt-1">{selfError}</p>}
                  </div>
                  <Button onClick={markSelfPresent} disabled={selfMarking || !selfAttendance?.canMarkPresent} className="gap-2">
                    <Check className="w-4 h-4" />
                    {selfMarking ? t("teacherAttendance.marking") : t("teacherAttendance.markPresent")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {!profile.mentorSection ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-700 font-semibold text-lg">{t("teacherAttendance.noClassAssigned")}</p>
                  <p className="text-gray-400 text-sm mt-2">
                    {t("teacherAttendance.noClassAssignedHint")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
            {/* Section Info */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t("teacherAttendance.title")}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {t("teacherAttendance.classSectionStudents", { className: profile.mentorSection.class.name, sectionName: profile.mentorSection.name, count: students.length })}
              </p>
            </div>

            {locked && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <Lock className="h-4 w-4 flex-shrink-0" />
                <span>{t("teacherAttendance.sessionLocked")}</span>
              </div>
            )}

            {/* Controls */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t("common.date")}</p>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={() => markAll("PRESENT")} disabled={!canMarkAttendance || locked}>{t("teacherAttendance.allPresent")}</Button>
                    <Button variant="outline" size="sm" onClick={() => markAll("ABSENT")} disabled={!canMarkAttendance || locked}>{t("teacherAttendance.allAbsent")}</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: t("common.present"), value: presentCount, color: "bg-green-50 border-green-200 text-green-700" },
                { label: t("common.absent"), value: absentCount, color: "bg-red-50 border-red-200 text-red-700" },
                { label: t("common.late"), value: lateCount, color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
                { label: t("teacherAttendance.onLeave"), value: onLeaveCount, color: "bg-blue-50 border-blue-200 text-blue-700" },
                { label: t("teacherAttendance.unmarked"), value: unmarkedCount, color: "bg-gray-50 border-gray-200 text-gray-600" },
              ].map((s) => (
                <div key={s.label} className={`rounded-lg border px-4 py-3 ${s.color}`}>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs font-medium mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {submitError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {submitError}
              </div>
            )}

            {/* Student List */}
            {loading ? (
              <div className="text-center py-12 text-gray-400">{t("teacherAttendance.loadingAttendance")}</div>
            ) : students.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <p className="text-gray-400">{t("teacherAttendance.noStudents")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                    <span>{t("teacherAttendance.studentsCount", { count: students.length })}</span>
                    <div className="flex gap-2">
                      {!locked && (
                        <Button variant="outline" onClick={saveDraft} disabled={saving || !canMarkAttendance} className="gap-2">
                          <Save className="w-4 h-4" />
                          {saving ? t("teacherAttendance.saving") : saved ? t("teacherAttendance.saved") : t("teacherAttendance.saveDraft")}
                        </Button>
                      )}
                      {!locked && (
                        <Button onClick={() => setConfirmingSubmit(true)} disabled={submitting || !canSubmitAttendance} className="gap-2">
                          <Lock className="w-4 h-4" />
                          {t("teacherAttendance.submitAttendance")}
                        </Button>
                      )}
                      {locked && (
                        <Button variant="outline" onClick={() => setCorrectionMode((v) => !v)} className="gap-2">
                          {correctionMode ? t("studentLeave.cancel") : t("teacherAttendance.requestCorrection")}
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {confirmingSubmit && (
                    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-medium">{t("teacherAttendance.confirmSubmitTitle")}</p>
                      <p className="mt-1 text-amber-800">{t("teacherAttendance.confirmSubmitWarning")}</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setConfirmingSubmit(false)}>{t("studentLeave.cancel")}</Button>
                        <Button size="sm" onClick={submitAttendance} disabled={submitting}>
                          {submitting ? t("teacherAttendance.submitting") : t("teacherAttendance.confirmSubmit")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {correctionMode && (
                    <div className="mb-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-sm font-medium text-foreground">{t("teacherAttendance.correctionDialogTitle")}</p>
                      <p className="text-xs text-muted-foreground">{t("teacherAttendance.correctionDialogHint")}</p>
                      {correctionError && <p className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">{correctionError}</p>}
                      <Textarea
                        rows={2}
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        placeholder={t("teacherAttendance.correctionReasonPlaceholder")}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setCorrectionMode(false); setCorrectionSelection({}); }}>
                          {t("studentLeave.cancel")}
                        </Button>
                        <Button size="sm" onClick={submitCorrection} disabled={correctionSaving}>
                          {correctionSaving ? t("teacherAttendance.submitting") : t("teacherAttendance.submitCorrectionRequest")}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {students.map((student) => {
                      const current = attendance[student.id];
                      const isSuggested = suggested[student.id];
                      const selectedForCorrection = student.id in correctionSelection;
                      return (
                        <div
                          key={student.id}
                          className={cn(
                            "flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100 hover:bg-gray-50",
                            selectedForCorrection && "border-primary bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            {correctionMode && (
                              <input
                                type="checkbox"
                                checked={selectedForCorrection}
                                onChange={() => toggleCorrectionStudent(student.id, current)}
                                className="h-4 w-4"
                              />
                            )}
                            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-sm font-semibold text-green-700">
                              {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{student.name}</p>
                              <p className="text-xs text-gray-400">
                                {t("teacherAttendance.rollLabel", { roll: student.rollNo })}
                                {isSuggested && (
                                  <span className="ml-2 text-blue-600 font-medium">{t("teacherAttendance.leaveSuggested")}</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {(["PRESENT", "ABSENT", "LATE", "ON_LEAVE"] as Status[]).map((s) => {
                              const cfg = statusConfig[s];
                              const active = correctionMode ? correctionSelection[student.id] === s : current === s;
                              return (
                                <button
                                  key={s}
                                  onClick={() => (correctionMode ? (selectedForCorrection ? setCorrectionRequestedStatus(student.id, s) : undefined) : setStatus(student.id, s))}
                                  disabled={!correctionMode && locked}
                                  className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                    active ? cfg.color : "bg-white text-gray-400 border-gray-200 hover:border-gray-300",
                                    locked && !correctionMode && "opacity-60 cursor-not-allowed"
                                  )}
                                >
                                  <cfg.icon className="w-3 h-3" />
                                  <span className="hidden sm:inline">{t(cfg.labelKey)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {todaysCorrections.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("teacherAttendance.correctionRequestsTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {todaysCorrections.map((c) => (
                    <div key={c.id} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-700">{c.reason}</p>
                        <Badge variant={correctionStatusVariant[c.status]}>{c.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {c.items.map((i) => `${i.student?.name ?? i.studentId}: ${i.originalStatus} → ${i.requestedStatus}`).join(", ")}
                      </p>
                      {c.reviewNote && <p className="mt-1 text-xs text-gray-500 italic">{c.reviewNote}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
              </>
            )}
          </>
        )}
    </div>
  );
}

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, Calendar, Plus, Trash2, Lock, Unlock, CheckCircle, AlertTriangle, ArrowRight, Loader2, Play, Settings, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { parseCostGuardError } from "@/lib/cost-guard-error-handler";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { createRequestSequencer } from "@/lib/request-sequencer";
import { clearStaleSubjectSelections } from "@/lib/smart-timetable-requirement-reconciliation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Teacher { id: string; name: string; subject: string | null }
interface Section { id: string; name: string }
interface ClassOption { id: string; name: string; sections: Section[] }

interface SubjectRequirement {
  id?: string;
  /** Canonical Master Subject id. Null for a not-yet-selected new row, or for a legacy pre-enforcement row that never had one. */
  subjectId: string | null;
  subjectName: string;
  requiredPeriodsPerWeek: number;
  minPeriodsPerDay: number | null;
  maxPeriodsPerDay: number | null;
  allowConsecutive: boolean;
  preferredTeacherId: string | null;
}

interface MasterSubjectOption { id: string; name: string }

interface DraftSlot {
  id: string;
  dayOfWeek: number;
  period: number;
  subjectName: string | null;
  teacherId: string | null;
  teacher: { id: string; name: string } | null;
  locked: boolean;
}

interface Draft {
  id: string;
  status: "DRAFT" | "VALID" | "INVALID";
  createdAt: string;
  slots?: DraftSlot[];
}

interface ValidationIssue {
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  metadata?: unknown;
}

interface TeacherRecommendation {
  teacherId: string;
  teacherName: string;
  score: number;
  label: string;
  workload: { current: number; maximum: number; remaining: number };
  reasons: { message: string }[];
  warnings: { message: string }[];
}

interface Props {
  schoolId: string;
  initialClasses: ClassOption[];
  initialTeachers: Teacher[];
  schoolSlug: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SmartTimetableWorkspace({ schoolId, initialClasses, initialTeachers, schoolSlug }: Props) {
  const { t } = useTranslation();
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");

  const [activeTab, setActiveTab] = useState<"requirements" | "drafts">("requirements");

  // Requirements state
  const [requirements, setRequirements] = useState<SubjectRequirement[]>([]);
  const [capacity, setCapacity] = useState<{ totalCapacity: number; requiredPeriods: number; isValid: boolean } | null>(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);

  // Master Subject options for the selected class/section — the only allowed
  // subjects for Weekly Period Requirements (see /lib/master-subjects.ts).
  const [masterSubjects, setMasterSubjects] = useState<MasterSubjectOption[]>([]);
  const [masterSubjectsLoading, setMasterSubjectsLoading] = useState(false);

  // Drafts state
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);

  // Active workspace state
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  // Grid editing state
  const [editingCell, setEditingCell] = useState<{ day: number; period: number } | null>(null);
  const [editingSubject, setEditingSubject] = useState("");
  const [recommendations, setRecommendations] = useState<TeacherRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Job progress tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);

  const selectedClass = initialClasses.find((c) => c.id === selectedClassId);
  const sections = selectedClass?.sections ?? [];

  // Guards the requirements/subjects fetch below against races: if the
  // class/section changes again before an in-flight fetch resolves, that
  // response's token no longer matches `sequencer.isCurrent(...)` and it is
  // discarded instead of overwriting the latest selection.
  const sequencerRef = useRef(createRequestSequencer());

  // Fetch requirements + the Master Subject options applicable to this
  // class/section.
  useEffect(() => {
    if (!selectedSectionId) {
      setRequirements([]);
      setCapacity(null);
      setMasterSubjects([]);
      return;
    }
    const token = sequencerRef.current.next();

    setReqLoading(true);
    setMasterSubjectsLoading(true);
    Promise.all([
      fetch(`/api/schools/${schoolId}/smart-timetable/requirements?sectionId=${selectedSectionId}`).then((r) => r.json()),
      fetch(`/api/schools/${schoolId}/subjects?classId=${selectedClassId}&sectionId=${selectedSectionId}&applicable=1`).then((r) => r.json()),
    ])
      .then(([reqData, subjectsData]) => {
        if (!sequencerRef.current.isCurrent(token)) return;
        const options: MasterSubjectOption[] = Array.isArray(subjectsData)
          ? subjectsData.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))
          : [];
        setMasterSubjects(options);
        // Drop any row (new or previously loaded) whose subjectId is no
        // longer among the valid options for this class/section — a stale
        // subject from a prior class/section must never be submitted.
        const validIds = new Set(options.map((o) => o.id));
        const requirementsRaw: SubjectRequirement[] = reqData.requirements || [];
        setRequirements(clearStaleSubjectSelections(requirementsRaw, validIds));
        setCapacity(reqData.capacity || null);
      })
      .catch((e) => {
        if (sequencerRef.current.isCurrent(token)) console.error(e);
      })
      .finally(() => {
        if (sequencerRef.current.isCurrent(token)) {
          setReqLoading(false);
          setMasterSubjectsLoading(false);
        }
      });

    // Fetch drafts list
    setDraftsLoading(true);
    fetch(`/api/schools/${schoolId}/smart-timetable/drafts?sectionId=${selectedSectionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (sequencerRef.current.isCurrent(token)) setDrafts(data.data || []);
      })
      .finally(() => {
        if (sequencerRef.current.isCurrent(token)) setDraftsLoading(false);
      });
  }, [selectedSectionId, selectedClassId, schoolId]);

  // Fetch selected draft detail
  useEffect(() => {
    if (!selectedDraftId) {
      setSelectedDraft(null);
      return;
    }
    refreshDraftDetails();
  }, [selectedDraftId, schoolId]);

  const refreshDraftDetails = async () => {
    setWorkspaceLoading(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}`);
      const data = await res.json();
      setSelectedDraft(data.draft ?? null);

      // Fetch quality score
      const qRes = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/quality`);
      const qData = await qRes.json();
      setQualityScore(qData.score);

      // Fetch validation diagnostics
      const vRes = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/validate`);
      const vData = await vRes.json();
      setValidationIssues(vData.issues || []);
    } catch (e) {
      console.error(e);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  // Recommendations trigger on subject select
  useEffect(() => {
    if (!editingCell || !editingSubject || !selectedDraftId) return;
    setRecsLoading(true);
    fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/teacher-recommendations?subjectName=${encodeURIComponent(editingSubject)}`)
      .then((r) => r.json())
      .then((data) => {
        setRecommendations(data.recommendations || []);
      })
      .finally(() => setRecsLoading(false));
  }, [editingSubject, editingCell, selectedDraftId, schoolId]);

  // Poll background job
  useEffect(() => {
    if (!activeJobId) return;

    const startTime = Date.now();
    let timer: NodeJS.Timeout;

    const poll = async () => {
      try {
        const res = await fetch(`/api/schools/${schoolId}/jobs/${activeJobId}`);
        if (!res.ok) return;
        const job = await res.json();
        setJobStatus(job.status);
        setJobProgress(Math.round(((job.processedItems + job.failedItems) / (job.totalItems || 1)) * 100));

        if (job.status === "COMPLETED" || job.status === "FAILED") {
          setActiveJobId(null);
          refreshDraftDetails();
          return;
        }

        const elapsed = Date.now() - startTime;
        let delay = 5000; // 0-1 min: 5 sec
        if (elapsed > 300000) {
          delay = 30000; // 5+ min: 30 sec
        } else if (elapsed > 60000) {
          delay = 15000; // 1-5 min: 15 sec
        }

        timer = setTimeout(poll, delay);
      } catch (e) {
        console.error(e);
        setActiveJobId(null);
      }
    };

    poll();
    return () => clearTimeout(timer);
  }, [activeJobId, schoolId]);

  const addRequirementRow = () => {
    if (masterSubjects.length === 0) return;
    setRequirements((prev) => [
      ...prev,
      {
        subjectId: null,
        subjectName: "",
        requiredPeriodsPerWeek: 3,
        minPeriodsPerDay: null,
        maxPeriodsPerDay: null,
        allowConsecutive: false,
        preferredTeacherId: null,
      },
    ]);
  };

  const removeRequirementRow = (idx: number) => {
    setRequirements((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveRequirements = async () => {
    if (masterSubjects.length === 0) return;
    setReqSaving(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/smart-timetable/requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          sectionId: selectedSectionId,
          // Legacy (pre-enforcement, subjectId-less) rows are never sent —
          // they're read-only here and are preserved server-side regardless.
          requirements: requirements.filter((r) => r.subjectId),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRequirements(data.requirements || []);
        setCapacity(data.capacity || null);
      } else {
        alert(data.error || t("smartTimetableWorkspace.failedToSaveRequirements"));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReqSaving(false);
    }
  };

  const createNewDraft = async () => {
    const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: selectedClassId, sectionId: selectedSectionId }),
    });
    if (res.ok) {
      const data = await res.json();
      setDrafts((prev) => [data.draft, ...prev]);
      setSelectedDraftId(data.draft.id);
    }
  };

  const deleteDraft = async (draftId: string) => {
    if (selectedDraftId === draftId) setSelectedDraftId(null);
  };

  const runGenerator = async (mode: "COMPLETE_REMAINING_ONLY" | "REOPTIMIZE_UNLOCKED") => {
    if (!selectedDraftId) return;
    setWorkspaceLoading(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionMode: mode }),
      });
      const result = await res.json();
      if (result.mode === "job") {
        setActiveJobId(result.jobId);
        setJobStatus(result.status || "QUEUED");
        setJobProgress(0);
      } else {
        refreshDraftDetails();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const publishDraftTimetable = async () => {
    if (!selectedDraftId) return;
    setWorkspaceLoading(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/publish`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        alert(`Timetable published successfully! Assigned ${result.slotsCount} live slots.`);
        setSelectedDraftId(null);
      } else {
        alert(`Publish failed: ${parseCostGuardError(res, result).message}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  // Slot mutations
  const assignSlot = async (teacherId: string | null) => {
    if (!editingCell || !selectedDraftId) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: editingCell.day,
          period: editingCell.period,
          subjectName: editingSubject,
          teacherId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(parseCostGuardError(res, data).message || t("smartTimetableWorkspace.assignmentConstraintViolation"));
      } else {
        setEditingCell(null);
        refreshDraftDetails();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAssigning(false);
    }
  };

  const clearSlot = async (day: number, period: number) => {
    if (!selectedDraftId) return;
    const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/slots?dayOfWeek=${day}&period=${period}`, {
      method: "DELETE",
    });
    if (res.ok) refreshDraftDetails();
  };

  const toggleLockSlot = async (day: number, period: number, currentLocked: boolean) => {
    if (!selectedDraftId) return;
    const res = await fetch(`/api/schools/${schoolId}/smart-timetable/drafts/${selectedDraftId}/slots/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayOfWeek: day, period, locked: !currentLocked }),
    });
    if (res.ok) refreshDraftDetails();
  };

  const renderSlotCell = (day: number, period: number) => {
    const slot = selectedDraft?.slots?.find((s) => s.dayOfWeek === day && s.period === period);
    const teacherName = slot?.teacher?.name ?? null;

    return (
      <div
        key={`${day}-${period}`}
        className={cn(
          "min-h-[72px] border border-gray-200 p-2 rounded-xl flex flex-col justify-between transition-all relative group cursor-pointer hover:border-blue-300 hover:shadow-sm",
          slot?.locked ? "bg-gray-50/70 border-gray-300" : "bg-white"
        )}
        onClick={() => {
          setEditingCell({ day, period });
          setEditingSubject(slot?.subjectName || "");
          setRecommendations([]);
        }}
      >
        {slot?.subjectName ? (
          <>
            <div>
              <p className="text-xs font-semibold text-gray-900 leading-tight">{slot.subjectName}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 truncate">{teacherName ?? t("smartTimetableWorkspace.noTeacherAssigned")}</p>
              <Badge
                variant={teacherName ? "success" : "warning"}
                className="text-[8px] px-1 py-0 h-3.5 mt-1"
              >
                {teacherName ? t("smartTimetableWorkspace.assignedBadge") : t("smartTimetableWorkspace.unassignedBadge")}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-1">
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-gray-150">
                P{period}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" 
                  size="icon" 
                  className="w-5 h-5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 shrink-0"
                  onClick={(e) => { e.stopPropagation(); clearSlot(day, period); }}
                  disabled={slot.locked}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost" 
                  size="icon" 
                  className={cn("w-5 h-5 shrink-0", slot.locked ? "text-blue-600 opacity-100" : "opacity-0 group-hover:opacity-100 text-gray-400")}
                  onClick={(e) => { e.stopPropagation(); toggleLockSlot(day, period, slot.locked); }}
                >
                  {slot.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[11px] text-gray-300 group-hover:text-blue-400 font-medium">Empty Cell</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Target Selector */}
      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Class</Label>
              <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setSelectedSectionId(""); setSelectedDraftId(null); }}>
                <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                <SelectContent>
                  {initialClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Section</Label>
              <Select value={selectedSectionId} onValueChange={(v) => { setSelectedSectionId(v); setSelectedDraftId(null); }}>
                <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                <SelectContent>
                  {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedSectionId ? (
        <>
          {/* Sub Navigation */}
          <div className="flex border-b border-gray-100 gap-6">
            <button
              onClick={() => setActiveTab("requirements")}
              className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "requirements" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
            >
              Requirements & Capacity
            </button>
            <button
              onClick={() => setActiveTab("drafts")}
              className={cn("pb-2.5 text-sm font-semibold border-b-2 px-1 transition-all", activeTab === "drafts" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-900")}
            >
              Drafts Workspace {drafts.length > 0 && `(${drafts.length})`}
            </button>
          </div>

          {activeTab === "requirements" ? (
            <Card className="border border-gray-150/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Weekly Periods Requirements</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={addRequirementRow}
                    disabled={masterSubjectsLoading || masterSubjects.length === 0}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Subject
                  </Button>
                </CardTitle>
                <CardDescription>Specify periods per subject and preferred faculty members for automated allocation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Capacity Gauge */}
                {capacity && (
                  <div className={cn(
                    "p-3 rounded-xl border flex items-center justify-between text-sm",
                    capacity.isValid ? "bg-green-50/50 border-green-200 text-green-800" : "bg-red-50/50 border-red-200 text-red-800"
                  )}>
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      <span>
                        <strong>Weekly Allocation Load:</strong> {capacity.requiredPeriods} required periods of {capacity.totalCapacity} total weekly capacity.
                      </span>
                    </div>
                    <Badge variant={capacity.isValid ? "success" : "destructive"}>
                      {capacity.isValid ? "Within Capacity" : "Capacity Overload"}
                    </Badge>
                  </div>
                )}

                {reqLoading || masterSubjectsLoading ? (
                  <div className="py-12 text-center text-gray-400">{t("smartTimetableRequirements.loadingSubjects")}</div>
                ) : masterSubjects.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-gray-300 rounded-xl space-y-2">
                    <p className="font-semibold text-gray-600 text-sm">{t("smartTimetableRequirements.noMasterSubjectsTitle")}</p>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto leading-normal">{t("smartTimetableRequirements.noMasterSubjectsBody")}</p>
                    <Link
                      href={`/dashboard/${schoolSlug}/subjects`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 mt-1"
                    >
                      {t("smartTimetableRequirements.goToSubjectMaster")} <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requirements.map((req, idx) => {
                      const isLegacy = Boolean(req.id) && !req.subjectId;
                      return (
                        <div key={req.id ?? idx} className="flex flex-wrap items-center gap-3 p-3.5 border border-gray-100 rounded-xl hover:bg-gray-50/50 transition-colors">
                          <div className="flex-1 min-w-[150px]">
                            <Label className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                              Subject
                              {isLegacy && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-300 text-amber-700 normal-case">
                                  {t("smartTimetableRequirements.legacyBadge")}
                                </Badge>
                              )}
                            </Label>
                            {isLegacy ? (
                              <p className="h-9 mt-1 flex items-center text-sm text-gray-700" title={t("smartTimetableRequirements.legacyNote")}>
                                {req.subjectName}
                              </p>
                            ) : (
                              <Select
                                value={req.subjectId ?? undefined}
                                onValueChange={(v) => {
                                  const chosen = masterSubjects.find((s) => s.id === v);
                                  const copy = [...requirements];
                                  copy[idx] = { ...copy[idx], subjectId: v, subjectName: chosen?.name ?? "" };
                                  setRequirements(copy);
                                }}
                              >
                                <SelectTrigger className="h-9 mt-1">
                                  <SelectValue placeholder={t("smartTimetableRequirements.subjectPlaceholder")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {masterSubjects.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="w-24">
                            <Label className="text-xs text-gray-400 uppercase tracking-wide">Periods/Week</Label>
                            <Input
                              type="number"
                              min={0}
                              value={req.requiredPeriodsPerWeek}
                              className="h-9 mt-1 text-center"
                              disabled={isLegacy}
                              onChange={(e) => {
                                const copy = [...requirements];
                                copy[idx].requiredPeriodsPerWeek = parseInt(e.target.value, 10) || 0;
                                setRequirements(copy);
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-[200px]">
                            <Label className="text-xs text-gray-400 uppercase tracking-wide">Preferred Faculty</Label>
                            <Select
                              value={req.preferredTeacherId || "__none__"}
                              disabled={isLegacy}
                              onValueChange={(v) => {
                                const copy = [...requirements];
                                copy[idx].preferredTeacherId = v === "__none__" ? null : v;
                                setRequirements(copy);
                              }}
                            >
                              <SelectTrigger className="h-9 mt-1">
                                <SelectValue placeholder="No preference" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No preference</SelectItem>
                                {initialTeachers.map((teacher) => (
                                  <SelectItem key={teacher.id} value={teacher.id}>{teacher.name} ({teacher.subject || "General"})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="mt-5 text-gray-400 hover:text-red-500 shrink-0 h-9 w-9"
                            onClick={() => removeRequirementRow(idx)}
                            disabled={isLegacy}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}

                    <div className="flex justify-end pt-2">
                      <Button onClick={saveRequirements} disabled={reqSaving} className="gap-2">
                        {reqSaving ? t("smartTimetableWorkspace.saving") : t("smartTimetableWorkspace.saveConfiguration")}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
              {/* Drafts List sidebar */}
              <div className="space-y-4">
                <Button className="w-full gap-1.5" onClick={createNewDraft}>
                  <Plus className="w-4 h-4" /> Create Draft
                </Button>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Active Drafts</p>
                  {draftsLoading ? (
                    <div className="text-sm text-gray-400 py-6 text-center">Loading drafts...</div>
                  ) : drafts.length === 0 ? (
                    <div className="text-xs text-gray-400 py-6 text-center border border-dashed rounded-xl">No drafts created yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {drafts.map((d, i) => (
                        <div
                          key={d.id}
                          className={cn(
                            "w-full text-left p-3 rounded-xl border text-sm flex items-center justify-between cursor-pointer transition-all",
                            selectedDraftId === d.id
                              ? "bg-blue-50 border-blue-200 text-blue-900 font-semibold"
                              : "border-gray-150 hover:bg-gray-50 text-gray-700"
                          )}
                          onClick={() => setSelectedDraftId(d.id)}
                        >
                          <div>
                            <p className="leading-tight">Draft #{drafts.length - i}</p>
                            <span className="text-[10px] text-gray-400 font-normal">
                              {new Date(d.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </span>
                          </div>
                          <Badge variant={d.status === "VALID" ? "success" : d.status === "INVALID" ? "destructive" : "secondary"} className="text-[9px] px-1.5 py-0 h-5">
                            {d.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Draft workspace */}
              {selectedDraftId ? (
                <div className="space-y-6">
                  {/* Workspace header actions */}
                  <Card className="border border-gray-150 shadow-sm bg-gray-50/30">
                    <CardContent className="py-4 flex flex-wrap gap-4 items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Active Draft Score</p>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="text-2xl font-bold tracking-tight text-gray-900">
                              {qualityScore !== null ? `${qualityScore}/100` : "—"}
                            </span>
                            <span className="text-xs text-gray-400">quality rating</span>
                          </div>
                        </div>

                        <div className="h-8 w-px bg-gray-200" />

                        <div>
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Teacher Assignment</p>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="text-2xl font-bold tracking-tight text-gray-900">
                              {selectedDraft?.slots?.filter((s) => s.subjectName && s.teacherId).length ?? 0}
                            </span>
                            <span className="text-xs text-gray-400">
                              assigned · {selectedDraft?.slots?.filter((s) => s.subjectName && !s.teacherId).length ?? 0} unassigned
                            </span>
                          </div>
                        </div>

                        <div className="h-8 w-px bg-gray-200" />

                        <div>
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Validation status</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            {selectedDraft?.status === "VALID" ? (
                              <Badge variant="success" className="gap-1 px-2 py-0.5"><CheckCircle className="w-3.5 h-3.5" /> Ready to Publish</Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1 px-2 py-0.5"><AlertTriangle className="w-3.5 h-3.5" /> Issues Found</Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => runGenerator("COMPLETE_REMAINING_ONLY")}>
                          <Play className="w-3.5 h-3.5" /> Complete Remaining
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => runGenerator("REOPTIMIZE_UNLOCKED")}>
                          <RefreshCw className="w-3.5 h-3.5" /> Reoptimize Unlocked
                        </Button>
                        <Button variant="default" size="sm" className="gap-1.5 h-9" onClick={publishDraftTimetable} disabled={selectedDraft?.status !== "VALID"}>
                          Publish Timetable
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Active background job display */}
                  {activeJobId && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between text-xs text-blue-800 font-semibold">
                        <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Timetable generation background job running...</span>
                        <span>{jobStatus} ({jobProgress}%)</span>
                      </div>
                      <div className="w-full bg-blue-100 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${jobProgress}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Validation issues display */}
                  {validationIssues.length > 0 && (
                    <div className="bg-red-50 border border-red-200 p-4 rounded-xl space-y-2">
                      <p className="text-xs font-bold text-red-800 uppercase tracking-wide">Validation Diagnostics ({validationIssues.length})</p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {validationIssues.map((issue, idx) => (
                          <p key={idx} className="text-xs text-red-700 leading-normal flex items-start gap-1.5">
                            <span className="text-red-500 mt-0.5">⚠️</span>
                            <span>{issue.message}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timetable grid */}
                  {workspaceLoading ? (
                    <div className="h-96 flex items-center justify-center text-gray-400">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                      <span className="text-sm">Loading grid workspace...</span>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-2xl overflow-x-auto bg-white">
                      <table className="w-full border-collapse text-left min-w-[700px]">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="p-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Period</th>
                            {DAYS.map((d) => (
                              <th key={d} className="p-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{d}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: 8 }).map((_, rIdx) => {
                            const period = rIdx + 1;
                            return (
                              <tr key={period} className="border-b border-gray-150 last:border-b-0 hover:bg-gray-50/30">
                                <td className="p-3 font-semibold text-xs text-gray-500 bg-gray-50/50 w-20">
                                  Period {period}
                                </td>
                                {Array.from({ length: 6 }).map((_, cIdx) => {
                                  const day = cIdx + 1;
                                  return (
                                    <td key={day} className="p-2 w-[150px]">
                                      {renderSlotCell(day, period)}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <Card className="border border-dashed border-gray-300">
                  <CardContent className="py-20 text-center text-gray-400 flex flex-col items-center">
                    <Calendar className="w-12 h-12 text-gray-300 mb-4" />
                    <p className="font-semibold text-gray-600 text-sm">No Active Draft Selected</p>
                    <p className="text-xs text-gray-400 mt-1 max-w-sm leading-normal">
                      Create a new draft or select an existing draft from the sidebar to manage, re-generate, and publish school timetables.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      ) : (
        <Card className="border border-dashed border-gray-300">
          <CardContent className="py-16 text-center text-gray-400">
            Select a class and section above to load the Smart Timetable Workspace.
          </CardContent>
        </Card>
      )}

      {/* Editing Slot Modal */}
      <Dialog open={editingCell !== null} onOpenChange={(open) => !open && setEditingCell(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Slot Assignment</DialogTitle>
            <DialogDescription>
              Assign a subject and pick a recommended faculty member for Day {editingCell?.day}, Period {editingCell?.period}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={editingSubject} onValueChange={(v) => { setEditingSubject(v); setRecommendations([]); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {/* Only canonical (Master-Subject-linked) requirements are offered here —
                      a legacy/unmapped requirement can't be placed into a new slot either
                      (see upsertDraftSlot's SUBJECT_NOT_APPLICABLE guard). */}
                  {requirements.filter((req) => req.subjectId).map((req) => (
                    <SelectItem key={req.subjectId} value={req.subjectName}>{req.subjectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editingSubject && (
              <div className="space-y-2.5">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">Recommended Faculty</Label>
                {recsLoading ? (
                  <div className="py-6 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> Computing teacher recommendations...
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="text-xs text-gray-400 py-4 text-center border rounded-lg">
                    No eligible teachers found for {editingSubject}.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {recommendations.map((rec) => (
                      <div 
                        key={rec.teacherId} 
                        className="flex items-center justify-between p-2.5 border border-gray-100 rounded-xl hover:bg-blue-50/30 hover:border-blue-200 transition-all cursor-pointer"
                        onClick={() => assignSlot(rec.teacherId)}
                      >
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{rec.teacherName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500">
                              Load: {rec.workload.current}/{rec.workload.maximum} pds
                            </span>
                            {rec.warnings.length > 0 && (
                              <span className="text-[9px] text-amber-600 font-medium">⚠️ {rec.warnings.length} warning(s)</span>
                            )}
                          </div>
                        </div>
                        <Badge 
                          variant={rec.label === "PERFECT" ? "success" : rec.label === "GOOD" ? "secondary" : "warning"}
                          className="text-[9px] px-1.5 py-0 h-5"
                        >
                          {rec.label} ({rec.score})
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" size="sm" onClick={() => setEditingCell(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => assignSlot(null)} disabled={assigning}>
              Clear Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

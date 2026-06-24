"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookCheck, CheckCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Assignment {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
}
interface Milestone { id: string; name: string; sequence: number; active: boolean }
interface RosterRow {
  studentId: string;
  name: string;
  rollNo: string;
  checked: boolean;
  checkedAt: string | null;
  remarks: string | null;
}

export default function TeacherNotebookPage() {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [assignmentKey, setAssignmentKey] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      fetch("/api/teacher/homework").then((r) => r.json()).then((d) => setAssignments(d.assignments || []));
      fetch("/api/teacher/exam-milestones").then((r) => r.json()).then((d) => setMilestones(d.milestones || []));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const selectedAssignment = useMemo(
    () => assignments.find((a) => `${a.sectionId}|${a.subject}` === assignmentKey) || null,
    [assignments, assignmentKey]
  );

  const loadRoster = useCallback(async (sectionId: string, subject: string, examMilestoneId: string) => {
    setLoading(true);
    const res = await fetch(
      `/api/teacher/notebook?sectionId=${sectionId}&subject=${encodeURIComponent(subject)}&examMilestoneId=${examMilestoneId}`
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setMessage(data.error || t("teacherNotebook.couldNotLoadRoster")); return; }
    setRoster(data.roster || []);
    setOverrides({});
  }, [t]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (selectedAssignment && milestoneId) {
        void loadRoster(selectedAssignment.sectionId, selectedAssignment.subject, milestoneId);
      } else {
        setRoster([]);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectedAssignment, milestoneId, loadRoster]);

  function isChecked(row: RosterRow) {
    return overrides[row.studentId] ?? row.checked;
  }

  async function saveChecks(checks: { studentId: string; checked: boolean }[]) {
    if (!selectedAssignment || !milestoneId) return;
    const res = await fetch("/api/teacher/notebook", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId: selectedAssignment.sectionId,
        subject: selectedAssignment.subject,
        examMilestoneId: milestoneId,
        checks,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || t("teacherNotebook.couldNotSaveChecks"));
      return false;
    }
    return true;
  }

  async function toggle(row: RosterRow, checked: boolean) {
    setOverrides((prev) => ({ ...prev, [row.studentId]: checked }));
    setSavingIds((prev) => new Set(prev).add(row.studentId));
    setMessage("");
    const ok = await saveChecks([{ studentId: row.studentId, checked }]);
    setSavingIds((prev) => { const next = new Set(prev); next.delete(row.studentId); return next; });
    if (!ok) {
      setOverrides((prev) => ({ ...prev, [row.studentId]: !checked }));
      return;
    }
    if (selectedAssignment) await loadRoster(selectedAssignment.sectionId, selectedAssignment.subject, milestoneId);
  }

  async function bulkSet(checked: boolean) {
    if (roster.length === 0) return;
    setBulkSaving(true);
    setOverrides(Object.fromEntries(roster.map((r) => [r.studentId, checked])));
    const ok = await saveChecks(roster.map((r) => ({ studentId: r.studentId, checked })));
    setBulkSaving(false);
    if (!ok) { setOverrides({}); return; }
    if (selectedAssignment) await loadRoster(selectedAssignment.sectionId, selectedAssignment.subject, milestoneId);
    setMessage(checked ? t("teacherNotebook.allMarkedChecked") : t("teacherNotebook.allMarkedUnchecked"));
  }

  const checkedCount = roster.filter((r) => isChecked(r)).length;
  const percentage = roster.length > 0 ? Math.round((checkedCount / roster.length) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("teacherNotebook.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("teacherNotebook.subtitle")}</p>
      </div>
      {message && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}

      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-2">
          <Select value={assignmentKey} onValueChange={setAssignmentKey}>
            <SelectTrigger><SelectValue placeholder={t("teacherNotebook.selectClassPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {assignments.map((a) => (
                <SelectItem key={`${a.sectionId}|${a.subject}`} value={`${a.sectionId}|${a.subject}`}>
                  {t("teacherNotebook.classSectionSubject", { className: a.className, sectionName: a.sectionName, subject: a.subject })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={milestoneId} onValueChange={setMilestoneId}>
            <SelectTrigger><SelectValue placeholder={t("teacherNotebook.selectMilestonePlaceholder")} /></SelectTrigger>
            <SelectContent>
              {milestones.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64" />
      ) : !selectedAssignment || !milestoneId ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">{t("teacherNotebook.selectToBegin")}</CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BookCheck className="w-4 h-4 text-indigo-600" /> {t("teacherNotebook.checkedSummary", { checked: checkedCount, total: roster.length, percentage })}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => bulkSet(true)} disabled={bulkSaving} className="gap-1">
                <CheckCheck className="w-3.5 h-3.5" /> {t("teacherNotebook.checkAll")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkSet(false)} disabled={bulkSaving} className="gap-1">
                <Square className="w-3.5 h-3.5" /> {t("teacherNotebook.uncheckAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={percentage} toned />
            <div className="divide-y divide-border rounded-lg border border-border">
              {roster.map((row) => {
                const checked = isChecked(row);
                const saving = savingIds.has(row.studentId);
                return (
                  <label
                    key={row.studentId}
                    className={cn("flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors", !saving && "cursor-pointer hover:bg-muted/50")}
                  >
                    <div>
                      <p className="font-medium text-foreground">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{t("teacherNotebook.rollLabel", { roll: row.rollNo })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {saving && <span className="text-xs text-muted-foreground">{t("teacherNotebook.saving")}</span>}
                      <Badge variant={checked ? "success" : "secondary"} className="hidden sm:inline-flex">{checked ? t("teacherNotebook.checked") : t("teacherNotebook.pending")}</Badge>
                      <Checkbox checked={checked} disabled={saving} onCheckedChange={(c) => toggle(row, c === true)} />
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Wand2, CheckCircle, ArrowLeft, ArrowRight,
  RefreshCw, Sparkles, Settings2, Layers, Shuffle, AlertTriangle, X, Users, CalendarClock, Edit3,
} from "lucide-react";

type Teacher = { id: string; name: string; subject: string | null };
type Section = { id: string; name: string };
type Class = { id: string; name: string; sections: Section[] };

type SubjectRow = {
  id: string;
  name: string;
  weeklyCount: number;
  teacherId: string;
  consecutiveCount: number;          // how many periods per block (1 = no grouping)
  distribution: "spread" | "random"; // how to spread blocks across days
  dailyMode: "consecutive" | "spread"; // "consecutive" = 2 back-to-back in 1 day; "spread" = 1 per day
};

type GeneratedSlot = {
  dayOfWeek: number;
  period: number;
  subject: string;
  teacherId: string;
  teacherName: string;
};

type UnplacedEntry = {
  subjectName: string;
  teacherId: string;
  teacherName: string;
  requested: number;
  placed: number;
  count: number;
};

type FreeSlot = { dayOfWeek: number; period: number };
type RankedTeacher = { id: string; name: string; subject: string | null; periodsPerWeek: number };

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SUBJECT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-green-100 text-green-800 border-green-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-pink-100 text-pink-800 border-pink-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-yellow-100 text-yellow-800 border-yellow-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-red-100 text-red-800 border-red-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
];

let idCounter = 0;
const newId = () => `subj-${Date.now()}-${++idCounter}`;

const makeSubject = (): SubjectRow => ({
  id: newId(),
  name: "",
  weeklyCount: 3,
  teacherId: "",
  consecutiveCount: 1,
  distribution: "spread",
  dailyMode: "spread",
});

interface Props {
  initialClasses: Class[];
  initialTeachers: Teacher[];
  schoolId: string;
  periodsPerDay: number;
}

export default function CustomTimetableClient({
  initialClasses,
  initialTeachers,
  schoolId,
  periodsPerDay: defaultPeriods,
}: Props) {
  const params = useParams<{ schoolSlug: string }>();
  const [step, setStep] = useState(1);

  // Step 1
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [periodsPerDay, setPeriodsPerDay] = useState(defaultPeriods);
  const [daysPerWeek, setDaysPerWeek] = useState(5);

  // Step 2
  const [subjects, setSubjects] = useState<SubjectRow[]>([makeSubject()]);
  const [optionsSubjectId, setOptionsSubjectId] = useState<string | null>(null);

  // Step 3+
  const [generatedSlots, setGeneratedSlots] = useState<GeneratedSlot[]>([]);
  const [unplaced, setUnplaced] = useState<UnplacedEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Resolution panel for one unplaced item at a time
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"slots" | "teacher" | "manual" | null>(null);
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [recommendedTeachers, setRecommendedTeachers] = useState<RankedTeacher[]>([]);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [manualDay, setManualDay] = useState("1");
  const [manualPeriod, setManualPeriod] = useState("1");

  const unplacedKey = (item: UnplacedEntry) => `${item.subjectName}|${item.teacherId}`;

  const selectedClass = initialClasses.find((c) => c.id === selectedClassId);
  const sections = selectedClass?.sections ?? [];
  const className = selectedClass?.name ?? "";
  const sectionName = sections.find((s) => s.id === selectedSectionId)?.name ?? "";

  const totalSlots = periodsPerDay * daysPerWeek;
  const totalWeeklyClasses = subjects.reduce((sum, s) => sum + s.weeklyCount, 0);

  const step1Valid = !!selectedClassId && !!selectedSectionId && periodsPerDay >= 1 && daysPerWeek >= 1;
  const step2Valid =
    subjects.length > 0 &&
    subjects.every((s) => s.name.trim() !== "" && s.weeklyCount >= 1 && s.teacherId !== "");

  const allSubjectNames = [...new Set(subjects.map((s) => s.name))];
  const getSubjectColor = useCallback(
    (name: string) => {
      const idx = allSubjectNames.indexOf(name);
      return SUBJECT_COLORS[Math.max(0, idx) % SUBJECT_COLORS.length];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjects]
  );

  const addSubject = () => setSubjects((prev) => [...prev, makeSubject()]);
  const removeSubject = (id: string) => setSubjects((prev) => prev.filter((s) => s.id !== id));
  const updateSubject = (id: string, field: keyof SubjectRow, value: string | number) =>
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const getTeacherGroups = (subjectName: string) => {
    const lower = subjectName.toLowerCase().trim();
    if (!lower) return { recommended: [], others: initialTeachers };
    const recommended = initialTeachers.filter((t) => t.subject?.toLowerCase().includes(lower));
    const recommendedIds = new Set(recommended.map((t) => t.id));
    const others = initialTeachers.filter((t) => !recommendedIds.has(t.id));
    return { recommended, others };
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const subjectConfigs = subjects.map((s) => ({
        name: s.name.trim(),
        weeklyCount: s.weeklyCount,
        teacherId: s.teacherId,
        teacherName: initialTeachers.find((t) => t.id === s.teacherId)?.name ?? "",
        // dailyMode drives consecutiveCount, distribution, and maxPerDay
        consecutiveCount: s.dailyMode === "consecutive" ? 2 : 1,
        distribution: s.dailyMode === "consecutive" ? "random" : "spread",
        maxPerDay: s.dailyMode === "consecutive" ? 2 : 1,
      }));

      const res = await fetch(`/api/schools/${schoolId}/custom-timetable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          sectionId: selectedSectionId,
          periodsPerDay,
          daysPerWeek,
          subjects: subjectConfigs,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setGeneratedSlots(data.slots);
      setUnplaced(data.unplaced ?? []);
      closeResolvePanel();
      setStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/schools/${schoolId}/custom-timetable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          sectionId: selectedSectionId,
          slots: generatedSlots,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }

      setStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  function closeResolvePanel() {
    setResolvingKey(null);
    setResolveMode(null);
    setFreeSlots([]);
    setRecommendedTeachers([]);
  }

  function dismissUnplaced(item: UnplacedEntry) {
    setUnplaced((prev) => prev.filter((u) => unplacedKey(u) !== unplacedKey(item)));
    closeResolvePanel();
  }

  async function openSlotsPanel(item: UnplacedEntry) {
    setResolvingKey(unplacedKey(item));
    setResolveMode("slots");
    setResolveLoading(true);
    const params = new URLSearchParams({
      sectionId: selectedSectionId,
      teacherId: item.teacherId,
      periodsPerDay: String(periodsPerDay),
      daysPerWeek: String(daysPerWeek),
    });
    const res = await fetch(`/api/schools/${schoolId}/custom-timetable/free-slots?${params.toString()}`);
    const data = await res.json();
    setResolveLoading(false);
    // Exclude cells already filled in this draft (not yet saved).
    const occupied = new Set(generatedSlots.map((s) => `${s.dayOfWeek}-${s.period}`));
    setFreeSlots((data.freeSlots ?? []).filter((s: FreeSlot) => !occupied.has(`${s.dayOfWeek}-${s.period}`)));
  }

  async function openTeacherPanel(item: UnplacedEntry) {
    setResolvingKey(unplacedKey(item));
    setResolveMode("teacher");
    setResolveLoading(true);
    const params = new URLSearchParams({ subject: item.subjectName, excludeTeacherId: item.teacherId });
    const res = await fetch(`/api/schools/${schoolId}/custom-timetable/recommend-teacher?${params.toString()}`);
    const data = await res.json();
    setResolveLoading(false);
    setRecommendedTeachers(data ?? []);
  }

  function openManualPanel(item: UnplacedEntry) {
    setResolvingKey(unplacedKey(item));
    setResolveMode("manual");
    setManualDay("1");
    setManualPeriod("1");
  }

  function placeOne(item: UnplacedEntry, slot: FreeSlot, teacherId = item.teacherId, teacherName = item.teacherName) {
    setGeneratedSlots((prev) => [
      ...prev.filter((s) => !(s.dayOfWeek === slot.dayOfWeek && s.period === slot.period)),
      { dayOfWeek: slot.dayOfWeek, period: slot.period, subject: item.subjectName, teacherId, teacherName },
    ]);
    setUnplaced((prev) => prev.flatMap((u) => {
      if (unplacedKey(u) !== unplacedKey(item)) return [u];
      const remaining = u.count - 1;
      return remaining > 0 ? [{ ...u, placed: u.placed + 1, count: remaining }] : [];
    }));
    setFreeSlots((prev) => prev.filter((s) => !(s.dayOfWeek === slot.dayOfWeek && s.period === slot.period)));
    if (item.count - 1 <= 0) closeResolvePanel();
  }

  function swapTeacherAndPlace(item: UnplacedEntry, teacher: RankedTeacher) {
    setResolveLoading(true);
    const params = new URLSearchParams({
      sectionId: selectedSectionId,
      teacherId: teacher.id,
      periodsPerDay: String(periodsPerDay),
      daysPerWeek: String(daysPerWeek),
    });
    fetch(`/api/schools/${schoolId}/custom-timetable/free-slots?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { freeSlots: FreeSlot[] }) => {
        const occupied = new Set(generatedSlots.map((s) => `${s.dayOfWeek}-${s.period}`));
        const available = (data.freeSlots ?? []).filter((s) => !occupied.has(`${s.dayOfWeek}-${s.period}`));
        const toPlace = available.slice(0, item.count);
        setGeneratedSlots((prev) => [
          ...prev,
          ...toPlace.map((slot) => ({ dayOfWeek: slot.dayOfWeek, period: slot.period, subject: item.subjectName, teacherId: teacher.id, teacherName: teacher.name })),
        ]);
        const stillNeeded = item.count - toPlace.length;
        setUnplaced((prev) => prev.flatMap((u) => {
          if (unplacedKey(u) !== unplacedKey(item)) return [u];
          if (stillNeeded <= 0) return [];
          return [{ subjectName: u.subjectName, teacherId: teacher.id, teacherName: teacher.name, requested: stillNeeded, placed: 0, count: stillNeeded }];
        }));
        closeResolvePanel();
      })
      .finally(() => setResolveLoading(false));
  }

  function manualPlace(item: UnplacedEntry) {
    const day = parseInt(manualDay, 10);
    const period = parseInt(manualPeriod, 10);
    if (isNaN(day) || day < 1 || day > daysPerWeek || isNaN(period) || period < 1 || period > periodsPerDay) return;
    placeOne(item, { dayOfWeek: day, period });
  }

  const handleReset = () => {
    setStep(1);
    setSelectedClassId("");
    setSelectedSectionId("");
    setPeriodsPerDay(defaultPeriods);
    setDaysPerWeek(5);
    setSubjects([makeSubject()]);
    setGeneratedSlots([]);
    setUnplaced([]);
    closeResolvePanel();
    setError("");
  };

  const buildGrid = (): (GeneratedSlot | null)[][] => {
    const grid: (GeneratedSlot | null)[][] = Array.from({ length: periodsPerDay }, () =>
      Array.from({ length: daysPerWeek }, () => null)
    );
    for (const slot of generatedSlots) {
      const r = slot.period - 1;
      const c = slot.dayOfWeek - 1;
      if (r >= 0 && r < periodsPerDay && c >= 0 && c < daysPerWeek) grid[r][c] = slot;
    }
    return grid;
  };

  // The subject whose options dialog is open
  const optSubj = subjects.find((s) => s.id === optionsSubjectId) ?? null;

  const STEPS = [
    { n: 1, label: "Setup" },
    { n: 2, label: "Subjects" },
    { n: 3, label: "Preview" },
    { n: 4, label: "Done" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-blue-600" />
          Custom Timetable Generator
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Configure subjects and periods, then let the system generate an optimized timetable
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map(({ n, label }, i) => (
          <div key={n} className="flex items-center">
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
              step === n ? "bg-blue-600 text-white" : step > n ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"
            )}>
              <span className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border",
                step === n ? "border-white" : step > n ? "border-green-400" : "border-gray-300"
              )}>
                {step > n ? "✓" : n}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("h-0.5 w-6 mx-1", step > n ? "bg-green-300" : "bg-gray-200")} />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1 ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Class & Configure Schedule</CardTitle>
            <CardDescription>Choose which class section to generate a timetable for and set the schedule structure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Class</Label>
                <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setSelectedSectionId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                  <SelectContent>
                    {initialClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Section</Label>
                <Select value={selectedSectionId} onValueChange={setSelectedSectionId} disabled={!selectedClassId}>
                  <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Periods Per Day</Label>
                <Input type="number" min={1} max={12} value={periodsPerDay}
                  onChange={(e) => setPeriodsPerDay(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))} />
                <p className="text-xs text-gray-400">How many periods are there each school day</p>
              </div>
              <div className="space-y-2">
                <Label>Days Per Week</Label>
                <Input type="number" min={1} max={6} value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(Math.max(1, Math.min(6, parseInt(e.target.value) || 5)))} />
                <p className="text-xs text-gray-400">Number of school days (max 6 for Mon–Sat)</p>
              </div>
            </div>
            {selectedClassId && selectedSectionId && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                Generating for <strong>{className} – {sectionName}</strong> with <strong>{totalSlots}</strong> total slots per week ({periodsPerDay} periods × {daysPerWeek} days)
              </div>
            )}
            <Button onClick={() => setStep(2)} disabled={!step1Valid} className="gap-2">
              Next: Configure Subjects <ArrowRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2 ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle>Configure Subjects & Teachers</CardTitle>
                <CardDescription>Add subjects for {className} – {sectionName} and assign teachers</CardDescription>
              </div>
              <div className={cn(
                "text-sm font-medium px-3 py-1 rounded-full border",
                totalWeeklyClasses > totalSlots ? "bg-red-50 text-red-700 border-red-200" :
                totalWeeklyClasses === totalSlots ? "bg-green-50 text-green-700 border-green-200" :
                "bg-gray-50 text-gray-600 border-gray-200"
              )}>
                {totalWeeklyClasses} / {totalSlots} slots
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {subjects.map((subj) => {
              const { recommended, others } = getTeacherGroups(subj.name);
              return (
                <div key={subj.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100 space-y-3">
                  <div className="flex gap-3 items-start">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Subject Name</Label>
                        <Input
                          placeholder="e.g. Mathematics"
                          value={subj.name}
                          onChange={(e) => updateSubject(subj.id, "name", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Classes / Week</Label>
                        <Input
                          type="number" min={1} max={totalSlots}
                          value={subj.weeklyCount}
                          onChange={(e) => updateSubject(subj.id, "weeklyCount", Math.max(1, parseInt(e.target.value) || 1))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">
                          Assign Teacher
                          {recommended.length > 0 && <span className="ml-1 text-green-600 font-medium">· {recommended.length} recommended</span>}
                        </Label>
                        <Select value={subj.teacherId} onValueChange={(v) => updateSubject(subj.id, "teacherId", v)}>
                          <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
                          <SelectContent>
                            {recommended.length > 0 && (
                              <>
                                <div className="px-2 py-1.5 text-xs font-semibold text-green-700 bg-green-50 sticky top-0">✓ Recommended for this subject</div>
                                {recommended.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}{t.subject ? <span className="text-gray-400 ml-1">({t.subject})</span> : null}</SelectItem>
                                ))}
                              </>
                            )}
                            {others.length > 0 && (
                              <>
                                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 mt-1">Other Teachers</div>
                                {others.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}{t.subject ? <span className="text-gray-400 ml-1">({t.subject})</span> : null}</SelectItem>
                                ))}
                              </>
                            )}
                            {initialTeachers.length === 0 && <div className="px-2 py-3 text-sm text-gray-400 text-center">No teachers found</div>}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <button
                      onClick={() => removeSubject(subj.id)}
                      disabled={subjects.length === 1}
                      className="mt-6 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Schedule options row */}
                  <div className="flex items-center gap-3 pt-1 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      {subj.dailyMode === "consecutive"
                        ? <><Layers className="w-3.5 h-3.5" /><span className="font-medium text-purple-700">2 consecutive in 1 day</span></>
                        : <><Shuffle className="w-3.5 h-3.5" /><span>1 per day, spread across week</span></>
                      }
                    </div>
                    <button
                      onClick={() => setOptionsSubjectId(subj.id)}
                      className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      <Settings2 className="w-3.5 h-3.5" /> Scheduling Options
                    </button>
                  </div>
                </div>
              );
            })}

            <Button variant="outline" onClick={addSubject} className="gap-2 w-full">
              <Plus className="w-4 h-4" /> Add Subject
            </Button>

            {totalWeeklyClasses > totalSlots && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                Total weekly classes ({totalWeeklyClasses}) exceeds available slots ({totalSlots}). Reduce class counts or increase periods/days in Step 1.
              </p>
            )}
            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={handleGenerate} disabled={!step2Valid || generating || totalWeeklyClasses > totalSlots} className="gap-2">
                <Wand2 className="w-4 h-4" />
                {generating ? "Generating…" : "Generate Timetable"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3 ── */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <CardTitle>Review Generated Timetable</CardTitle>
                  <CardDescription>{className} – {sectionName} · Accept to save or go back to modify</CardDescription>
                </div>
                <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-full border border-gray-200">
                  {generatedSlots.length} of {totalSlots} slots filled
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {unplaced.length > 0 && (
                <div className="mb-4 space-y-2">
                  {unplaced.map((item) => {
                    const key = unplacedKey(item);
                    const isOpen = resolvingKey === key;
                    return (
                      <div key={key} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <p className="text-sm text-amber-800">
                            <strong>{item.teacherName}</strong> — {item.subjectName}: requested {item.requested}, placed {item.placed},{" "}
                            <strong>{item.count} period{item.count !== 1 ? "s" : ""} unassigned</strong>
                          </p>
                          <div className="ml-auto flex gap-1.5 flex-wrap">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openSlotsPanel(item)}>
                              <CalendarClock className="w-3 h-3" /> Alternate Slots
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openTeacherPanel(item)}>
                              <Users className="w-3 h-3" /> Alternate Teacher
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openManualPanel(item)}>
                              <Edit3 className="w-3 h-3" /> Manual Resolve
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-gray-500" onClick={() => dismissUnplaced(item)}>
                              <X className="w-3 h-3" /> Keep as unassigned
                            </Button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="mt-3 rounded-md bg-white border border-amber-100 p-3">
                            {resolveLoading ? (
                              <p className="text-xs text-gray-400">Loading…</p>
                            ) : resolveMode === "slots" ? (
                              freeSlots.length === 0 ? (
                                <p className="text-xs text-gray-400">No free slots available for this teacher.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {freeSlots.map((slot) => (
                                    <button
                                      key={`${slot.dayOfWeek}-${slot.period}`}
                                      onClick={() => placeOne(item, slot)}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                    >
                                      {DAY_NAMES[slot.dayOfWeek]} P{slot.period}
                                    </button>
                                  ))}
                                </div>
                              )
                            ) : resolveMode === "teacher" ? (
                              recommendedTeachers.length === 0 ? (
                                <p className="text-xs text-gray-400">No other active teachers available.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {recommendedTeachers.map((t) => (
                                    <button
                                      key={t.id}
                                      onClick={() => swapTeacherAndPlace(item, t)}
                                      className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                                    >
                                      <span className="font-medium text-gray-800">{t.name} {t.subject ? `(${t.subject})` : ""}</span>
                                      <span className="text-gray-400">{t.periodsPerWeek} periods/week</span>
                                    </button>
                                  ))}
                                </div>
                              )
                            ) : resolveMode === "manual" ? (
                              <div className="flex items-end gap-2 flex-wrap">
                                <div className="space-y-1">
                                  <Label className="text-xs text-gray-500">Day (1-{daysPerWeek})</Label>
                                  <Input type="number" min={1} max={daysPerWeek} value={manualDay} onChange={(e) => setManualDay(e.target.value)} className="w-20 h-8" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-gray-500">Period (1-{periodsPerDay})</Label>
                                  <Input type="number" min={1} max={periodsPerDay} value={manualPeriod} onChange={(e) => setManualPeriod(e.target.value)} className="w-20 h-8" />
                                </div>
                                <Button size="sm" onClick={() => manualPlace(item)}>Assign</Button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-4">
                {subjects.map((s) => {
                  const teacher = initialTeachers.find((t) => t.id === s.teacherId);
                  return (
                    <span key={s.id} className={cn("px-2.5 py-1 rounded-full text-xs font-medium border", getSubjectColor(s.name))}>
                      {s.name} · {teacher?.name ?? "—"} ({s.weeklyCount}/wk
                      {s.dailyMode === "consecutive" ? ", 2×consecutive" : ", 1/day"})
                    </span>
                  );
                })}
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full border-collapse text-sm min-w-[480px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="p-3 text-left text-gray-500 font-medium border-b border-gray-200 w-20">Period</th>
                      {Array.from({ length: daysPerWeek }, (_, i) => (
                        <th key={i + 1} className="p-3 text-center text-gray-700 font-semibold border-b border-gray-200">{DAY_NAMES[i + 1]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {buildGrid().map((row, pIdx) => (
                      <tr key={pIdx} className="border-b border-gray-100 last:border-0">
                        <td className="p-3 text-gray-400 font-medium text-center text-xs">P{pIdx + 1}</td>
                        {row.map((cell, dIdx) => {
                          // Check if this cell continues from the cell above (consecutive visual)
                          const grid = buildGrid();
                          const above = pIdx > 0 ? grid[pIdx - 1][dIdx] : null;
                          const isConsecutiveWith = above && above.subject === cell?.subject && above.teacherId === cell?.teacherId;
                          return (
                            <td key={dIdx} className="p-1.5">
                              {cell ? (
                                <div className={cn(
                                  "rounded-md p-2 text-center border",
                                  getSubjectColor(cell.subject),
                                  isConsecutiveWith && "rounded-t-none border-t-0 -mt-2 pt-1"
                                )}>
                                  <div className="font-semibold text-xs leading-tight">{cell.subject}</div>
                                  <div className="text-xs opacity-70 truncate mt-0.5">{cell.teacherName}</div>
                                </div>
                              ) : (
                                <div className="rounded-md p-2 text-center bg-gray-50 text-gray-300 text-xs border border-dashed border-gray-200">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg mt-3">{error}</p>}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Edit
            </Button>
            <Button variant="outline" onClick={handleGenerate} disabled={generating} className="gap-2">
              <RefreshCw className={cn("w-4 h-4", generating && "animate-spin")} /> Regenerate
            </Button>
            <Button onClick={handleAccept} disabled={saving || generatedSlots.length === 0} className="gap-2 bg-green-600 hover:bg-green-700 text-white ml-auto">
              <CheckCircle className="w-4 h-4" />
              {saving ? "Saving…" : "Accept & Save Timetable"}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4 ── */}
      {step === 4 && (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-9 h-9 text-green-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Timetable Saved!</h2>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">
              The timetable for <strong>{className} – {sectionName}</strong> has been saved successfully and is now active.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button variant="outline" onClick={handleReset}>Generate Another</Button>
              <Button asChild><Link href={`/dashboard/${params.schoolSlug}/timetable`}>View Full Timetable</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Scheduling Options Dialog ── */}
      <Dialog open={!!optionsSubjectId} onOpenChange={(open) => { if (!open) setOptionsSubjectId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-blue-600" />
              Scheduling Options
              {optSubj?.name && <span className="text-blue-600">— {optSubj.name}</span>}
            </DialogTitle>
          </DialogHeader>

          {optSubj && (
            <div className="space-y-5 pt-2">
              <div>
                <Label className="text-sm font-semibold">How should classes be scheduled each day?</Label>
                <p className="text-xs text-gray-500 mt-1">
                  Choose how this subject&apos;s classes are arranged. Maximum 2 classes per day is always enforced.
                </p>
              </div>

              <div className="space-y-2">
                {/* Option A: 1 consecutive slot (2 back-to-back in 1 day) */}
                <label className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors",
                  optSubj.dailyMode === "consecutive"
                    ? "bg-purple-50 border-purple-300"
                    : "bg-white border-gray-200 hover:bg-gray-50"
                )}>
                  <input
                    type="radio"
                    name={`dailyMode-${optSubj.id}`}
                    checked={optSubj.dailyMode === "consecutive"}
                    onChange={() => updateSubject(optSubj.id, "dailyMode", "consecutive")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">2 consecutive classes in 1 day</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Both classes happen back-to-back on the same day (double period). Good for subjects needing longer uninterrupted sessions.
                    </p>
                    {optSubj.dailyMode === "consecutive" && (
                      <p className="text-xs text-purple-700 mt-2 font-medium">
                        {optSubj.weeklyCount} classes = {Math.floor(optSubj.weeklyCount / 2)} double-period day{Math.floor(optSubj.weeklyCount / 2) !== 1 ? "s" : ""}
                        {optSubj.weeklyCount % 2 > 0 ? " + 1 single class" : ""}
                      </p>
                    )}
                  </div>
                </label>

                {/* Option B: spread — 1 per day on different days */}
                <label className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors",
                  optSubj.dailyMode === "spread"
                    ? "bg-blue-50 border-blue-300"
                    : "bg-white border-gray-200 hover:bg-gray-50"
                )}>
                  <input
                    type="radio"
                    name={`dailyMode-${optSubj.id}`}
                    checked={optSubj.dailyMode === "spread"}
                    onChange={() => updateSubject(optSubj.id, "dailyMode", "spread")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">1 class per day, on different days</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Each class is placed on a separate day — distributes the subject evenly across the week.
                    </p>
                    {optSubj.dailyMode === "spread" && (
                      <p className="text-xs text-blue-700 mt-2 font-medium">
                        {optSubj.weeklyCount} classes spread across {optSubj.weeklyCount} different day{optSubj.weeklyCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </label>
              </div>

              <Button onClick={() => setOptionsSubjectId(null)} className="w-full">Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

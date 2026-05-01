"use client";

import { useState, useCallback, useMemo } from "react";
import { CalendarDays, X, GripVertical, Settings2, AlertTriangle, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Teacher { id: string; name: string; subject: string | null }
interface Section { id: string; name: string }
interface Class { id: string; name: string; sections: Section[] }
interface SlotTeacher { id: string; name: string; subject: string | null }
interface Slot { sectionId: string; dayOfWeek: number; period: number; teacherId: string | null; subject: string | null; teacher: SlotTeacher | null }
interface ConflictEntry { day: number; period: number; className: string; sectionName: string; subject: string | null }
interface BusySlot { teacherId: string; dayOfWeek: number; period: number }

interface Props {
  initialClasses: Class[];
  initialTeachers: Teacher[];
  initialBusySlots: BusySlot[];
  schoolId: string;
}

const SUBJECT_COLORS = [
  { bg: "bg-indigo-50",  border: "border-indigo-200",  accent: "border-l-indigo-400",  name: "text-indigo-900",  sub: "text-indigo-500",  dot: "bg-indigo-400",  badge: "bg-indigo-100 text-indigo-700"  },
  { bg: "bg-emerald-50", border: "border-emerald-200", accent: "border-l-emerald-400", name: "text-emerald-900", sub: "text-emerald-600", dot: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700" },
  { bg: "bg-amber-50",   border: "border-amber-200",   accent: "border-l-amber-400",   name: "text-amber-900",   sub: "text-amber-600",   dot: "bg-amber-400",   badge: "bg-amber-100 text-amber-700"   },
  { bg: "bg-rose-50",    border: "border-rose-200",    accent: "border-l-rose-400",    name: "text-rose-900",    sub: "text-rose-500",    dot: "bg-rose-400",    badge: "bg-rose-100 text-rose-700"    },
  { bg: "bg-violet-50",  border: "border-violet-200",  accent: "border-l-violet-400",  name: "text-violet-900",  sub: "text-violet-500",  dot: "bg-violet-400",  badge: "bg-violet-100 text-violet-700"  },
  { bg: "bg-teal-50",    border: "border-teal-200",    accent: "border-l-teal-400",    name: "text-teal-900",    sub: "text-teal-600",    dot: "bg-teal-400",    badge: "bg-teal-100 text-teal-700"    },
  { bg: "bg-orange-50",  border: "border-orange-200",  accent: "border-l-orange-400",  name: "text-orange-900",  sub: "text-orange-600",  dot: "bg-orange-400",  badge: "bg-orange-100 text-orange-700"  },
  { bg: "bg-sky-50",     border: "border-sky-200",     accent: "border-l-sky-400",     name: "text-sky-900",     sub: "text-sky-500",     dot: "bg-sky-400",     badge: "bg-sky-100 text-sky-700"     },
  { bg: "bg-pink-50",    border: "border-pink-200",    accent: "border-l-pink-400",    name: "text-pink-900",    sub: "text-pink-500",    dot: "bg-pink-400",    badge: "bg-pink-100 text-pink-700"    },
  { bg: "bg-lime-50",    border: "border-lime-200",    accent: "border-l-lime-400",    name: "text-lime-900",    sub: "text-lime-600",    dot: "bg-lime-400",    badge: "bg-lime-100 text-lime-700"    },
] as const;

function getSubjectColor(key: string | null | undefined) {
  const str = key || "default";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffff;
  }
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

export default function TimetableClient({ initialClasses, initialTeachers, initialBusySlots, schoolId }: Props) {
  const [classes] = useState<Class[]>(initialClasses);
  const [teachers] = useState<Teacher[]>(initialTeachers);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [periodsInput, setPeriodsInput] = useState("6");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [allBusySlots, setAllBusySlots] = useState<BusySlot[]>(initialBusySlots);
  const [teacherSearch, setTeacherSearch] = useState("");

  const [draggingTeacherId, setDraggingTeacherId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pendingTeacherId, setPendingTeacherId] = useState<string | null>(null);
  const [subjectInput, setSubjectInput] = useState("");
  const [dayPeriods, setDayPeriods] = useState<Record<number, string>>({});
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSlots = useCallback(async (sectionId: string) => {
    setLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/timetable?sectionId=${sectionId}`);
    const data = await res.json();
    setPeriodsPerDay(data.periodsPerDay || 6);
    setPeriodsInput(String(data.periodsPerDay || 6));
    setSlots(data.slots || []);
    setLoading(false);
  }, [schoolId]);

  const refreshBusySlots = useCallback(async () => {
    const res = await fetch(`/api/schools/${schoolId}/timetable?allSlots=true`);
    const d = await res.json();
    setAllBusySlots(d.slots || []);
  }, [schoolId]);

  function handleSectionChange(sectionId: string) {
    setSelectedSectionId(sectionId);
    if (sectionId) fetchSlots(sectionId);
    else setSlots([]);
  }

  function getSlot(day: number, period: number): Slot | undefined {
    return slots.find((s) => s.dayOfWeek === day && s.period === period);
  }

  function onDragStart(e: React.DragEvent, teacherId: string) {
    setDraggingTeacherId(teacherId);
    e.dataTransfer.setData("teacherId", teacherId);
    e.dataTransfer.effectAllowed = "copy";
  }

  function onDrop(e: React.DragEvent, day: number, period: number) {
    e.preventDefault();
    const tid = e.dataTransfer.getData("teacherId") || draggingTeacherId;
    if (!tid) return;
    const teacher = teachers.find((t) => t.id === tid);
    setPendingTeacherId(tid);
    setSubjectInput(teacher?.subject || "");
    setDayPeriods({ [day]: String(period) });
    setConflicts([]); setValidationError("");
    setAssignOpen(true);
  }

  function parseSlotsToAssign(): { day: number; period: number }[] | null {
    const result: { day: number; period: number }[] = [];
    for (let d = 1; d <= 6; d++) {
      const raw = dayPeriods[d]?.trim();
      if (!raw) continue;
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        const num = parseInt(p, 10);
        if (isNaN(num) || num < 1 || num > periodsPerDay) return null;
        result.push({ day: d, period: num });
      }
    }
    return result;
  }

  async function confirmAssign() {
    setValidationError("");
    const slotsToAssign = parseSlotsToAssign();
    if (slotsToAssign === null) { setValidationError(`All period numbers must be between 1 and ${periodsPerDay}.`); return; }
    if (slotsToAssign.length === 0) { setValidationError("Enter at least one period for any day."); return; }

    if (conflicts.length === 0) {
      const found: ConflictEntry[] = [];
      await Promise.all(slotsToAssign.map(async ({ day, period }) => {
        try {
          const res = await fetch(`/api/schools/${schoolId}/timetable?checkConflict=true&teacherId=${pendingTeacherId}&dayOfWeek=${day}&period=${period}&sectionId=${selectedSectionId}`);
          const data = await res.json();
          if (data.conflict) found.push({ day, period, className: data.className, sectionName: data.sectionName, subject: data.subject });
        } catch { /* non-blocking */ }
      }));
      if (found.length > 0) { setConflicts(found); return; }
    }

    setSaving(true);
    const results = await Promise.all(slotsToAssign.map(({ day, period }) =>
      fetch(`/api/schools/${schoolId}/timetable`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: selectedSectionId, dayOfWeek: day, period, teacherId: pendingTeacherId, subject: subjectInput.trim() || null }),
      }).then((r) => r.json())
    ));
    setSlots((prev) => {
      let updated = [...prev];
      slotsToAssign.forEach(({ day, period }, i) => {
        updated = updated.filter((s) => !(s.dayOfWeek === day && s.period === period));
        if (results[i] && !results[i].error) updated.push(results[i]);
      });
      return updated;
    });
    setSaving(false);
    refreshBusySlots();
    closeDialog();
  }

  function closeDialog() {
    setAssignOpen(false); setPendingTeacherId(null); setSubjectInput("");
    setDayPeriods({}); setConflicts([]); setValidationError("");
  }

  function getFreePeriods(teacherId: string, day: number): number[] {
    const busy = new Set(allBusySlots.filter((s) => s.teacherId === teacherId && s.dayOfWeek === day).map((s) => s.period));
    return Array.from({ length: periodsPerDay }, (_, i) => i + 1).filter((p) => !busy.has(p));
  }

  const DAY_LETTERS = ["M", "T", "W", "Th", "F", "Sa"];
  function freePeriodsLabel(teacherId: string): string {
    return DAY_LETTERS.map((lbl, di) => {
      const free = getFreePeriods(teacherId, di + 1);
      if (free.length === 0) return null;
      if (free.length === periodsPerDay) return `${lbl}:all`;
      return `${lbl}:${free.join(",")}`;
    }).filter(Boolean).join("  ");
  }

  function isDayInputInvalid(val: string): boolean {
    if (!val.trim()) return false;
    return val.split(",").some((p) => { const n = parseInt(p.trim(), 10); return isNaN(n) || n < 1 || n > periodsPerDay; });
  }

  async function clearSlot(day: number, period: number) {
    await fetch(`/api/schools/${schoolId}/timetable`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId: selectedSectionId, dayOfWeek: day, period, teacherId: null }),
    });
    setSlots((prev) => prev.filter((s) => !(s.dayOfWeek === day && s.period === period)));
    refreshBusySlots();
  }

  async function savePeriodsPerDay() {
    const n = parseInt(periodsInput, 10);
    if (isNaN(n) || n < 1 || n > 12) return;
    await fetch(`/api/schools/${schoolId}/timetable`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodsPerDay: n }),
    });
    setPeriodsPerDay(n);
    if (selectedSectionId) fetchSlots(selectedSectionId);
  }

  // Build subject legend from current slots
  const subjectLegend = useMemo(() => {
    const seen = new Map<string, ReturnType<typeof getSubjectColor>>();
    for (const s of slots) {
      const key = s.subject || (s.teacher?.name ?? null);
      if (key && !seen.has(key)) seen.set(key, getSubjectColor(key));
    }
    return seen;
  }, [slots]);

  const selectedSections = classes.find((c) => c.id === selectedClassId)?.sections ?? [];
  const pendingTeacher = teachers.find((t) => t.id === pendingTeacherId);
  const hasConflicts = conflicts.length > 0;
  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const selectedSection = selectedSections.find((s) => s.id === selectedSectionId);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Timetable</h2>
          <p className="text-sm text-gray-500 mt-0.5">Drag teachers onto slots to build the schedule</p>
        </div>
        {selectedClass && selectedSection && (
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">
              {["Nursery", "LKG", "UKG"].includes(selectedClass.name) ? selectedClass.name : `Class ${selectedClass.name}`}
              {" "}&mdash; Section {selectedSection.name}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <Card className="shadow-sm border-gray-200">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Class</Label>
              <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setSelectedSectionId(""); setSlots([]); }}>
                <SelectTrigger className="w-44 bg-white"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{["Nursery", "LKG", "UKG"].includes(c.name) ? c.name : `Class ${c.name}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClassId && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Section</Label>
                <Select value={selectedSectionId} onValueChange={handleSectionChange}>
                  <SelectTrigger className="w-40 bg-white"><SelectValue placeholder="Select section" /></SelectTrigger>
                  <SelectContent>
                    {selectedSections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 ml-auto">
              <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Periods / Day
              </Label>
              <div className="flex gap-2 items-center">
                <Input type="number" min={1} max={12} value={periodsInput} onChange={(e) => setPeriodsInput(e.target.value)} className="w-20 text-center bg-white" />
                <Button size="sm" variant="outline" onClick={savePeriodsPerDay} className="bg-white">Apply</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedSectionId ? (
        <Card className="shadow-sm border-gray-200">
          <CardContent className="py-24 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
              <CalendarDays className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-600 font-semibold text-base">No class selected</p>
            <p className="text-gray-400 text-sm mt-1">Choose a class and section above to view or edit the timetable</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-5">
          {/* Teacher sidebar */}
          <div className="w-56 shrink-0 space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Teachers</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text" placeholder="Search teachers…" value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5">
              {teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase())).map((t) => {
                const freeLabel = freePeriodsLabel(t.id);
                const color = getSubjectColor(t.subject || t.name);
                return (
                  <div
                    key={t.id} draggable onDragStart={(e) => onDragStart(e, t.id)}
                    className="flex items-start gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:shadow-sm transition-all select-none group"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-300 shrink-0 mt-0.5 transition-colors" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-800 truncate">{t.name}</p>
                      {t.subject && (
                        <span className={cn("inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full", color.badge)}>
                          {t.subject}
                        </span>
                      )}
                      {freeLabel ? (
                        <p className="text-[10px] text-green-600 font-medium mt-1 leading-snug break-words">{freeLabel}</p>
                      ) : (
                        <p className="text-[10px] text-red-400 font-medium mt-1">fully booked</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase())).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">No teachers found</p>
              )}
            </div>
          </div>

          {/* Timetable grid */}
          <div className="flex-1 min-w-0 space-y-4">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm bg-white">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                        <th className="w-16 px-3 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider text-center border-b border-r border-gray-200">
                          #
                        </th>
                        {DAYS.map((d, di) => (
                          <th key={d} className="px-3 py-3.5 text-xs font-bold text-gray-600 uppercase tracking-wider text-center border-b border-r border-gray-200 last:border-r-0 min-w-[140px]">
                            <span className="hidden sm:inline">{DAY_FULL[di]}</span>
                            <span className="sm:hidden">{d}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((period) => (
                        <tr key={period} className="group/row hover:bg-gray-50/60 transition-colors">
                          <td className="px-3 py-2 text-center border-b border-r border-gray-100 last:border-b-0 bg-gray-50/80">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-500 shadow-sm">
                              {period}
                            </span>
                          </td>
                          {DAYS.map((_, di) => {
                            const day = di + 1;
                            const slot = getSlot(day, period);
                            const colorKey = slot?.subject || slot?.teacher?.name;
                            const color = getSubjectColor(colorKey);
                            return (
                              <td
                                key={day}
                                className="p-1.5 border-b border-r border-gray-100 last:border-r-0"
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => onDrop(e, day, period)}
                              >
                                {slot?.teacher ? (
                                  <div className={cn(
                                    "relative group/slot rounded-xl min-h-[58px] border border-l-[3px] transition-all hover:shadow-md",
                                    color.bg, color.border, color.accent
                                  )}>
                                    <div className="px-2.5 py-2">
                                      <p className={cn("text-xs font-bold leading-tight truncate", color.name)}>
                                        {slot.teacher.name}
                                      </p>
                                      {slot.subject && (
                                        <p className={cn("text-[11px] font-medium mt-0.5 truncate", color.sub)}>
                                          {slot.subject}
                                        </p>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => clearSlot(day, period)}
                                      className="absolute top-1.5 right-1.5 opacity-0 group-hover/slot:opacity-100 w-4 h-4 flex items-center justify-center rounded-full bg-white/80 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all shadow-sm"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className={cn(
                                    "min-h-[58px] rounded-xl border-2 border-dashed flex items-center justify-center transition-all",
                                    "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 group-hover/row:border-gray-300"
                                  )}>
                                    <span className="text-[11px] text-gray-300 select-none">Drop here</span>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Subject legend */}
                {subjectLegend.size > 0 && (
                  <div className="flex flex-wrap gap-2 px-1">
                    {Array.from(subjectLegend.entries()).map(([subject, color]) => (
                      <span key={subject} className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", color.badge)}>
                        <span className={cn("w-2 h-2 rounded-full", color.dot)} />
                        {subject}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Assign Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {pendingTeacher && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <div className={cn("w-2 h-2 rounded-full", getSubjectColor(pendingTeacher.subject || pendingTeacher.name).dot)} />
                <p className="text-sm text-gray-700">
                  <strong>{pendingTeacher.name}</strong>
                  {pendingTeacher.subject && <span className="text-gray-400 font-normal"> · {pendingTeacher.subject}</span>}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Subject <span className="text-gray-400 font-normal text-xs">(optional, applies to all slots)</span></Label>
              <Input placeholder="e.g. Mathematics, Science…" value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Periods per day</Label>
                <span className="text-xs text-gray-400">max {periodsPerDay} · e.g. 1,3,5</span>
              </div>
              <div className="space-y-2">
                {DAYS.map((dayLabel, di) => {
                  const d = di + 1;
                  const val = dayPeriods[d] ?? "";
                  const invalid = isDayInputInvalid(val);
                  return (
                    <div key={d} className="flex items-center gap-3">
                      <span className="w-10 text-sm font-semibold text-gray-600 shrink-0">{dayLabel}</span>
                      <Input
                        placeholder="—" value={val}
                        onChange={(e) => { setDayPeriods((prev) => ({ ...prev, [d]: e.target.value })); setConflicts([]); setValidationError(""); }}
                        className={cn("h-8 text-sm", invalid && "border-red-400 focus-visible:ring-red-400")}
                      />
                      {invalid && <span className="text-xs text-red-500 shrink-0">1–{periodsPerDay}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            {validationError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{validationError}</p>}
            {hasConflicts && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />Scheduling conflicts detected
                </div>
                {conflicts.map((c, i) => (
                  <p key={i} className="text-xs text-amber-800 pl-6">
                    {DAYS[c.day - 1]} P{c.period} — already in Class {c.className} – Sec {c.sectionName}{c.subject ? ` (${c.subject})` : ""}
                  </p>
                ))}
                <p className="text-xs text-amber-600 pl-6 pt-0.5">Click &quot;Assign Anyway&quot; to override.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={confirmAssign}
              disabled={saving}
              className={cn(hasConflicts ? "bg-amber-500 hover:bg-amber-600" : "bg-indigo-600 hover:bg-indigo-700")}
            >
              {saving ? "Saving…" : hasConflicts ? "Assign Anyway" : "Assign All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

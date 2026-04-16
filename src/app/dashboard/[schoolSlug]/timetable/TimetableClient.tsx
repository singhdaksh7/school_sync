"use client";

import { useState, useCallback } from "react";
import { CalendarDays, X, GripVertical, Settings2, AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const selectedSections = classes.find((c) => c.id === selectedClassId)?.sections ?? [];
  const pendingTeacher = teachers.find((t) => t.id === pendingTeacherId);
  const hasConflicts = conflicts.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Timetable</h2>
        <p className="text-sm text-gray-500 mt-1">Drag teachers to slots to build the class timetable</p>
      </div>

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Class</Label>
              <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setSelectedSectionId(""); setSlots([]); }}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{["Nursery", "LKG", "UKG"].includes(c.name) ? c.name : `Class ${c.name}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClassId && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section</Label>
                <Select value={selectedSectionId} onValueChange={handleSectionChange}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="Select section" /></SelectTrigger>
                  <SelectContent>
                    {selectedSections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 ml-auto">
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1"><Settings2 className="w-3 h-3" /> Periods/Day</Label>
              <div className="flex gap-2 items-center">
                <Input type="number" min={1} max={12} value={periodsInput} onChange={(e) => setPeriodsInput(e.target.value)} className="w-20 text-center" />
                <Button size="sm" variant="outline" onClick={savePeriodsPerDay}>Apply</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedSectionId ? (
        <Card><CardContent className="py-20 text-center"><CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">Select a class and section to view the timetable</p></CardContent></Card>
      ) : (
        <div className="flex gap-4">
          <div className="w-52 shrink-0 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Teachers</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input type="text" placeholder="Search..." value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div className="space-y-1.5">
              {teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase())).map((t) => {
                const freeLabel = freePeriodsLabel(t.id);
                return (
                  <div key={t.id} draggable onDragStart={(e) => onDragStart(e, t.id)}
                    className="flex items-start gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-blue-400 hover:bg-blue-50 transition-colors select-none">
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{t.name}</p>
                      {t.subject && <p className="text-xs text-gray-400 truncate">{t.subject}</p>}
                      {freeLabel ? (
                        <p className="text-[10px] text-green-600 font-medium mt-1 leading-tight break-words">{freeLabel}</p>
                      ) : (
                        <p className="text-[10px] text-red-400 font-medium mt-1">fully booked</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase())).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">No teachers found</p>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded" />)}</div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-20 px-2 py-2 text-xs font-semibold text-gray-500 text-left bg-gray-50 border border-gray-200">Period</th>
                    {DAYS.map((d) => <th key={d} className="px-2 py-2 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 text-center min-w-[130px]">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((period) => (
                    <tr key={period}>
                      <td className="px-2 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 text-center">P{period}</td>
                      {DAYS.map((_, di) => {
                        const day = di + 1;
                        const slot = getSlot(day, period);
                        return (
                          <td key={day} className="border border-gray-200 p-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, day, period)}>
                            {slot?.teacher ? (
                              <div className="relative group bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 min-h-[52px]">
                                <p className="text-xs font-semibold text-blue-800 leading-tight">{slot.teacher.name}</p>
                                {slot.subject && <p className="text-xs text-blue-500 mt-0.5">{slot.subject}</p>}
                                <button onClick={() => clearSlot(day, period)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-blue-400 hover:text-red-500 transition-opacity">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className={cn("min-h-[52px] rounded-md border-2 border-dashed flex items-center justify-center text-gray-300 transition-colors", "border-gray-200 hover:border-blue-300 hover:bg-blue-50")}>
                                <span className="text-xs">Drop here</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Dialog open={assignOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            {pendingTeacher && (
              <p className="text-sm text-gray-600">Teacher: <strong>{pendingTeacher.name}</strong>{pendingTeacher.subject && <span className="text-gray-400"> · {pendingTeacher.subject}</span>}</p>
            )}
            <div className="space-y-1.5">
              <Label>Subject <span className="text-gray-400 font-normal">(optional, applies to all slots)</span></Label>
              <Input placeholder="e.g. Mathematics, Science..." value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Periods per day</Label>
                <span className="text-xs text-gray-400">max period: {periodsPerDay} · e.g. 1,3,5</span>
              </div>
              <div className="space-y-2">
                {DAYS.map((dayLabel, di) => {
                  const d = di + 1;
                  const val = dayPeriods[d] ?? "";
                  const invalid = isDayInputInvalid(val);
                  return (
                    <div key={d} className="flex items-center gap-3">
                      <span className="w-10 text-sm font-medium text-gray-700 shrink-0">{dayLabel}</span>
                      <Input placeholder="—" value={val} onChange={(e) => { setDayPeriods((prev) => ({ ...prev, [d]: e.target.value })); setConflicts([]); setValidationError(""); }}
                        className={cn("h-8 text-sm", invalid && "border-red-400 focus-visible:ring-red-400")} />
                      {invalid && <span className="text-xs text-red-500 shrink-0">1–{periodsPerDay}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            {validationError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{validationError}</p>}
            {hasConflicts && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-amber-700 font-medium text-sm"><AlertTriangle className="w-4 h-4 shrink-0" />Scheduling conflicts detected</div>
                {conflicts.map((c, i) => (
                  <p key={i} className="text-xs text-amber-800 pl-6">{DAYS[c.day - 1]} P{c.period} — already assigned to Class {c.className} – Sec {c.sectionName}{c.subject ? ` (${c.subject})` : ""}</p>
                ))}
                <p className="text-xs text-amber-600 pl-6 pt-0.5">Click &quot;Assign Anyway&quot; to proceed.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={confirmAssign} disabled={saving} className={hasConflicts ? "bg-amber-600 hover:bg-amber-700" : ""}>
              {saving ? "Saving..." : hasConflicts ? "Assign Anyway" : "Assign All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

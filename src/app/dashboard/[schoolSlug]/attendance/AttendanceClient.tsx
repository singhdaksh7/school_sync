"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardCheck, Check, X, Clock, Save, Users, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE";
interface Section { id: string; name: string; class: { name: string } }
interface Teacher { id: string; name: string; subject: string | null }
interface Student { id: string; name: string; rollNo: string; sectionId: string }
interface AttendanceRecord { [id: string]: AttendanceStatus }

const statusConfig = {
  PRESENT: { label: "Present", icon: Check, color: "bg-green-100 text-green-700 border-green-300" },
  ABSENT: { label: "Absent", icon: X, color: "bg-red-100 text-red-700 border-red-300" },
  LATE: { label: "Late", icon: Clock, color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
};

interface Props {
  initialSections: Section[];
  initialTeachers: Teacher[];
  initialAttendance: Record<string, string>;
  schoolId: string;
}

export default function AttendanceClient({ initialSections, initialTeachers, initialAttendance, schoolId }: Props) {
  const [mode, setMode] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [sections] = useState<Section[]>(initialSections);
  const [selectedSection, setSelectedSection] = useState("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers] = useState<Teacher[]>(initialTeachers);
  const [attendance, setAttendance] = useState<AttendanceRecord>(initialAttendance as AttendanceRecord);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchStudents = useCallback(async (sectionId: string) => {
    const url = sectionId !== "all"
      ? `/api/schools/${schoolId}/students?sectionId=${sectionId}`
      : `/api/schools/${schoolId}/students`;
    const res = await fetch(url);
    setStudents(await res.json());
  }, [schoolId]);

  const fetchExisting = useCallback(async (d: string, type: string, sectionId: string | null) => {
    setLoading(true);
    const url = `/api/schools/${schoolId}/attendance?date=${d}&type=${type}${sectionId && sectionId !== "all" ? `&sectionId=${sectionId}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    const map: AttendanceRecord = {};
    data.forEach((r: any) => {
      const id = type === "STUDENT" ? r.studentId : r.teacherId;
      map[id] = r.status;
    });
    setAttendance(map);
    setLoading(false);
  }, [schoolId]);

  // Load students on mount (server pre-loaded attendance for today; fetch students)
  useEffect(() => {
    fetchStudents("all");
  }, [fetchStudents]);

  // Re-fetch when mode / date / section change (skip initial render)
  useEffect(() => {
    if (mode === "STUDENT") {
      fetchStudents(selectedSection);
      fetchExisting(date, "STUDENT", selectedSection);
    } else {
      fetchExisting(date, "TEACHER", null);
    }
  }, [mode, date, selectedSection]); // eslint-disable-line react-hooks/exhaustive-deps

  function setStatus(id: string, status: AttendanceStatus) {
    setAttendance((prev) => ({ ...prev, [id]: status }));
  }

  function markAll(status: AttendanceStatus) {
    const items = mode === "STUDENT" ? students : teachers;
    const map: AttendanceRecord = {};
    items.forEach((i) => { map[i.id] = status; });
    setAttendance(map);
  }

  async function saveAttendance() {
    const items = mode === "STUDENT" ? students : teachers;
    const records = items.map((i) => ({
      id: i.id,
      status: attendance[i.id] || "ABSENT",
      ...(mode === "STUDENT" ? { sectionId: (i as Student).sectionId } : {}),
    }));
    setSaving(true);
    const res = await fetch(`/api/schools/${schoolId}/attendance`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, type: mode, records }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  const items = mode === "STUDENT" ? students : teachers;
  const presentCount = items.filter((i) => attendance[i.id] === "PRESENT").length;
  const absentCount = items.filter((i) => attendance[i.id] === "ABSENT").length;
  const lateCount = items.filter((i) => attendance[i.id] === "LATE").length;
  const unmarkedCount = items.filter((i) => !attendance[i.id]).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Attendance</h2>
          <p className="text-sm text-gray-500 mt-1">Mark daily attendance for students and teachers</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</p>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type</p>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["STUDENT", "TEACHER"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={cn(
                    "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
                    mode === m ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  )}>
                    {m === "STUDENT" ? <GraduationCap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    {m === "STUDENT" ? "Students" : "Teachers"}
                  </button>
                ))}
              </div>
            </div>
            {mode === "STUDENT" && sections.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section</p>
                <Select value={selectedSection} onValueChange={setSelectedSection}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sections</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.class.name} - Section {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {mode === "TEACHER" && (
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => markAll("PRESENT")}>All Present</Button>
                <Button variant="outline" size="sm" onClick={() => markAll("ABSENT")}>All Absent</Button>
              </div>
            )}
            {mode === "STUDENT" && (
              <div className="ml-auto flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                <ClipboardCheck className="w-4 h-4" />
                Student attendance is marked by class mentors only
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Present", value: presentCount, color: "bg-green-50 border-green-200 text-green-700" },
          { label: "Absent", value: absentCount, color: "bg-red-50 border-red-200 text-red-700" },
          { label: "Late", value: lateCount, color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
          { label: "Unmarked", value: unmarkedCount, color: "bg-gray-50 border-gray-200 text-gray-600" },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg border px-4 py-3 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <ClipboardCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No {mode === "STUDENT" ? "students" : "teachers"} found</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{items.length} {mode === "STUDENT" ? "Students" : "Teachers"}</span>
              {mode === "TEACHER" && (
                <Button onClick={saveAttendance} disabled={saving} className="gap-2">
                  <Save className="w-4 h-4" />
                  {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {items.map((item) => {
                const current = attendance[item.id];
                return (
                  <div key={item.id} className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold",
                        mode === "STUDENT" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {item.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                        <p className="text-xs text-gray-400">
                          {mode === "STUDENT" ? `Roll: ${(item as Student).rollNo}` : (item as Teacher).subject || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {mode === "STUDENT" ? (
                        current ? (
                          <span className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium", statusConfig[current as AttendanceStatus].color)}>
                            {(() => { const cfg = statusConfig[current as AttendanceStatus]; return <><cfg.icon className="w-3 h-3" /><span>{cfg.label}</span></>; })()}
                          </span>
                        ) : <span className="text-xs text-gray-400 italic">Not marked</span>
                      ) : (
                        (["PRESENT", "ABSENT", "LATE"] as AttendanceStatus[]).map((s) => {
                          const cfg = statusConfig[s];
                          return (
                            <button key={s} onClick={() => setStatus(item.id, s)} className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                              current === s ? cfg.color : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                            )}>
                              <cfg.icon className="w-3 h-3" />{cfg.label}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {mode === "TEACHER" && (
              <div className="mt-4 flex justify-end">
                <Button onClick={saveAttendance} disabled={saving} className="gap-2">
                  <Save className="w-4 h-4" />
                  {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

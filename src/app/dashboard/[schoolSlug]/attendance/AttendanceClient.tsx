"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardCheck, Check, X, Clock, Users, GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import AttendanceCorrectionsPanel from "@/components/dashboard/AttendanceCorrectionsPanel";

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE";
interface Section { id: string; name: string; class: { name: string } }
interface Teacher { id: string; name: string; subject: string | null }
interface Student { id: string; name: string; rollNo: string; sectionId: string }
interface AttendanceRecord { [id: string]: AttendanceStatus }
interface ApiAttendanceRow {
  studentId?: string | null;
  teacherId?: string | null;
  status: AttendanceStatus;
}

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
  initialTeacherAttendanceCutoffTime: string;
}

export default function AttendanceClient({
  initialSections,
  initialTeachers,
  initialAttendance,
  schoolId,
  initialTeacherAttendanceCutoffTime,
}: Props) {
  const [mode, setMode] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [sections] = useState<Section[]>(initialSections);
  const [selectedSection, setSelectedSection] = useState("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers] = useState<Teacher[]>(initialTeachers);
  const [attendance, setAttendance] = useState<AttendanceRecord>(initialAttendance as AttendanceRecord);
  const [loading, setLoading] = useState(false);
  const [cutoffTime, setCutoffTime] = useState(initialTeacherAttendanceCutoffTime);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [autoAbsentRunning, setAutoAbsentRunning] = useState(false);
  const [teacherAttendanceMessage, setTeacherAttendanceMessage] = useState("");
  const [teacherAttendanceError, setTeacherAttendanceError] = useState("");

  const fetchStudents = useCallback(async (sectionId: string) => {
    const url = sectionId !== "all"
      ? `/api/schools/${schoolId}/students?sectionId=${sectionId}`
      : `/api/schools/${schoolId}/students?limit=500`;
    const res = await fetch(url);
    const body = await res.json();
    setStudents(body.data ?? body);
  }, [schoolId]);

  const fetchExisting = useCallback(async (d: string, type: string, sectionId: string | null) => {
    setLoading(true);
    const url = `/api/schools/${schoolId}/attendance?date=${d}&type=${type}${sectionId && sectionId !== "all" ? `&sectionId=${sectionId}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    const map: AttendanceRecord = {};
    (data as ApiAttendanceRow[]).forEach((r) => {
      const id = type === "STUDENT" ? r.studentId : r.teacherId;
      if (id) map[id] = r.status;
    });
    setAttendance(map);
    setLoading(false);
  }, [schoolId]);

  // Re-fetch when mode / date / section change (skip initial render)
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (mode === "STUDENT") {
        fetchStudents(selectedSection);
        fetchExisting(date, "STUDENT", selectedSection);
      } else {
        fetchExisting(date, "TEACHER", null);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [mode, date, selectedSection, fetchStudents, fetchExisting]);

  async function saveCutoffTime() {
    setSettingsSaving(true);
    setTeacherAttendanceMessage("");
    setTeacherAttendanceError("");
    const res = await fetch(`/api/schools/${schoolId}/settings/attendance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherAttendanceCutoffTime: cutoffTime }),
    });
    const data = await res.json();
    setSettingsSaving(false);
    if (res.ok) {
      setCutoffTime(data.teacherAttendanceCutoffTime);
      setTeacherAttendanceMessage("Cutoff time updated");
      return;
    }
    setTeacherAttendanceError(data.error || "Failed to update cutoff time");
  }

  async function runAutoAbsent() {
    setAutoAbsentRunning(true);
    setTeacherAttendanceMessage("");
    setTeacherAttendanceError("");
    const res = await fetch(`/api/schools/${schoolId}/attendance/teacher-auto-absent`, { method: "POST" });
    const data = await res.json();
    setAutoAbsentRunning(false);
    if (res.ok) {
      setTeacherAttendanceMessage(`Auto-absent complete: ${data.createdAbsent} teacher(s) marked absent`);
      fetchExisting(date, "TEACHER", null);
      return;
    }
    setTeacherAttendanceError(data.error || "Failed to run auto-absent check");
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
          <p className="text-sm text-gray-500 mt-1">Review daily attendance and manage teacher cutoff settings</p>
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
              <div className="ml-auto flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Teacher Cutoff</p>
                  <input
                    type="time"
                    value={cutoffTime}
                    onChange={(e) => setCutoffTime(e.target.value)}
                    className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={saveCutoffTime} disabled={settingsSaving}>
                  {settingsSaving ? "Saving..." : "Save Cutoff"}
                </Button>
                <Button size="sm" onClick={runAutoAbsent} disabled={autoAbsentRunning} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  {autoAbsentRunning ? "Checking..." : "Run Auto-Absent"}
                </Button>
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

      {mode === "TEACHER" && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <p className="font-medium">Teachers mark their own attendance before {cutoffTime}.</p>
          <p className="mt-1 text-blue-700">
            Admins can review status here and run auto-absent after the cutoff; direct teacher present/absent marking is disabled.
          </p>
          {teacherAttendanceMessage && <p className="mt-2 text-green-700">{teacherAttendanceMessage}</p>}
          {teacherAttendanceError && <p className="mt-2 text-red-700">{teacherAttendanceError}</p>}
        </div>
      )}

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
                      ) : current ? (
                        <span className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium", statusConfig[current as AttendanceStatus].color)}>
                          {(() => { const cfg = statusConfig[current as AttendanceStatus]; return <><cfg.icon className="w-3 h-3" /><span>{cfg.label}</span></>; })()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Not marked</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "STUDENT" && (
        <div className="pt-4">
          <h3 className="mb-3 text-lg font-bold text-gray-900">Submitted Attendance, Corrections &amp; History</h3>
          <AttendanceCorrectionsPanel schoolId={schoolId} />
        </div>
      )}
    </div>
  );
}

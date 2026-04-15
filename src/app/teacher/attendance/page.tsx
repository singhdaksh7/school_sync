"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";
import {
  GraduationCap, LogOut, Save, Check, X, Clock, ClipboardCheck, FileText, CalendarDays, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "PRESENT" | "ABSENT" | "LATE";

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

const statusConfig = {
  PRESENT: { label: "Present", icon: Check, color: "bg-green-100 text-green-700 border-green-300" },
  ABSENT: { label: "Absent", icon: X, color: "bg-red-100 text-red-700 border-red-300" },
  LATE: { label: "Late", icon: Clock, color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
};

export default function TeacherAttendancePage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [attendance, setAttendance] = useState<Record<string, Status>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/teacher/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setProfileError(d.error);
        else setProfile(d);
      });
  }, []);

  const fetchAttendance = useCallback(async (d: string) => {
    setLoading(true);
    const res = await fetch(`/api/teacher/attendance?date=${d}`);
    if (res.ok) {
      const data = await res.json();
      const map: Record<string, Status> = {};
      data.forEach((r: { studentId: string; status: Status }) => { map[r.studentId] = r.status; });
      setAttendance(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.mentorSection) fetchAttendance(date);
  }, [date, profile, fetchAttendance]);

  function setStatus(id: string, status: Status) {
    setAttendance((prev) => ({ ...prev, [id]: status }));
  }

  function markAll(status: Status) {
    const map: Record<string, Status> = {};
    profile?.mentorSection?.students.forEach((s) => { map[s.id] = status; });
    setAttendance(map);
  }

  async function save() {
    if (!profile?.mentorSection) return;
    const records = profile.mentorSection.students.map((s) => ({
      id: s.id,
      status: attendance[s.id] || "ABSENT",
    }));
    setSaving(true);
    const res = await fetch("/api/teacher/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, records }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  const students = profile?.mentorSection?.students ?? [];
  const presentCount = students.filter((s) => attendance[s.id] === "PRESENT").length;
  const absentCount = students.filter((s) => attendance[s.id] === "ABSENT").length;
  const lateCount = students.filter((s) => attendance[s.id] === "LATE").length;
  const unmarkedCount = students.filter((s) => !attendance[s.id]).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">SchoolSync</p>
            {profile && <p className="text-xs text-gray-400">{profile.school.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {profile && (
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-800">{profile.name}</p>
              <p className="text-xs text-gray-400">Teacher Portal</p>
            </div>
          )}
          <Link href="/teacher/timetable">
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarDays className="w-4 h-4" /> My Timetable
            </Button>
          </Link>
          <Link href="/teacher/marks">
            <Button variant="outline" size="sm" className="gap-2">
              <FileText className="w-4 h-4" /> Enter Marks
            </Button>
          </Link>
          <Link href="/teacher/arrangements">
            <Button variant="outline" size="sm" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Arrangements
            </Button>
          </Link>
          <Link href="/teacher/leaves">
            <Button variant="outline" size="sm" className="gap-2">
              <ClipboardCheck className="w-4 h-4" /> My Leaves
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2 text-gray-500">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {profileError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-red-600 font-medium">{profileError}</p>
            </CardContent>
          </Card>
        ) : !profile ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : !profile.mentorSection ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-700 font-semibold text-lg">No class assigned yet</p>
              <p className="text-gray-400 text-sm mt-2">
                Your school admin has not assigned you a class section. Please contact them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Section Info */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
              <p className="text-sm text-gray-500 mt-1">
                Class {profile.mentorSection.class.name} — Section {profile.mentorSection.name} &middot;{" "}
                {students.length} students
              </p>
            </div>

            {/* Controls */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</p>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={() => markAll("PRESENT")}>All Present</Button>
                    <Button variant="outline" size="sm" onClick={() => markAll("ABSENT")}>All Absent</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
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

            {/* Student List */}
            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading attendance...</div>
            ) : students.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <p className="text-gray-400">No students in this section yet.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{students.length} Students</span>
                    <Button onClick={save} disabled={saving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {students.map((student) => {
                      const current = attendance[student.id];
                      return (
                        <div
                          key={student.id}
                          className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100 hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-sm font-semibold text-green-700">
                              {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{student.name}</p>
                              <p className="text-xs text-gray-400">Roll: {student.rollNo}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {(["PRESENT", "ABSENT", "LATE"] as Status[]).map((s) => {
                              const cfg = statusConfig[s];
                              return (
                                <button
                                  key={s}
                                  onClick={() => setStatus(student.id, s)}
                                  className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                    current === s
                                      ? cfg.color
                                      : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                                  )}
                                >
                                  <cfg.icon className="w-3 h-3" />
                                  <span className="hidden sm:inline">{cfg.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={save} disabled={saving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

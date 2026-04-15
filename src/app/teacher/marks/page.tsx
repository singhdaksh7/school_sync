"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { GraduationCap, LogOut, Save, FileText, ChevronLeft, CalendarDays, RefreshCw, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface Student { id: string; name: string; rollNo: string }
interface TeachingSection { sectionId: string; sectionName: string; className: string; subject: string; students: Student[] }
interface Exam { id: string; name: string; maxMarks: number; order: number }
interface Scheme { id: string; name: string; exams: Exam[] }
interface TeacherProfile { id: string; name: string; school: { id: string; name: string; slug: string } }

export default function TeacherMarksPage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [sections, setSections] = useState<TeachingSection[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedSection, setSelectedSection] = useState<TeachingSection | null>(null);
  const [selectedScheme, setSelectedScheme] = useState<Scheme | null>(null);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/teacher/me").then((r) => r.json()).then((d) => { if (!d.error) setProfile(d); });
    fetch("/api/teacher/timetable").then((r) => r.json()).then((d) => {
      if (!d.error) setSections(d.teachingSections || []);
    });
  }, []);

  useEffect(() => {
    if (!profile?.school?.id) return;
    fetch(`/api/schools/${profile.school.id}/exam-schemes`).then((r) => r.json()).then((d) => {
      if (!d.error) setSchemes(d);
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedExam || !selectedSection) return;
    fetch(`/api/teacher/results?examId=${selectedExam.id}&sectionId=${selectedSection.sectionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          const m: Record<string, number> = {};
          data.forEach((r: { studentId: string; marks: number }) => { m[r.studentId] = r.marks; });
          setExisting(m);
          const filled: Record<string, string> = {};
          data.forEach((r: { studentId: string; marks: number }) => { filled[r.studentId] = String(r.marks); });
          setMarks(filled);
        }
      });
  }, [selectedExam, selectedSection]);

  async function submitMarks() {
    if (!selectedExam || !selectedSection) return;
    const results = selectedSection.students.map((s) => ({
      studentId: s.id,
      marks: parseFloat(marks[s.id] || "0"),
    }));
    setSaving(true);
    const res = await fetch("/api/teacher/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId: selectedExam.id,
        sectionId: selectedSection.sectionId,
        results,
      }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

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
        <div className="flex items-center gap-3">
          <Link href="/teacher/attendance">
            <Button variant="outline" size="sm" className="gap-2">
              <ChevronLeft className="w-4 h-4" /> Attendance
            </Button>
          </Link>
          <Link href="/teacher/timetable">
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarDays className="w-4 h-4" /> My Timetable
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
          {profile && <p className="text-sm font-medium text-gray-700 hidden sm:block">{profile.name}</p>}
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2 text-gray-500">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enter Marks</h1>
          <p className="text-sm text-gray-500 mt-1">Submit exam results for your assigned classes</p>
        </div>

        {sections.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-700 font-semibold">No classes assigned</p>
              <p className="text-gray-400 text-sm mt-2">You have no sections in the timetable. Contact admin.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Selectors */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section</p>
                    <Select
                      value={selectedSection?.sectionId || ""}
                      onValueChange={(v) => {
                        const s = sections.find((s) => s.sectionId === v) || null;
                        setSelectedSection(s);
                        setMarks({});
                        setExisting({});
                      }}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s.sectionId} value={s.sectionId}>
                            Class {s.className} – Sec {s.sectionName}{s.subject ? ` (${s.subject})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Exam Scheme</p>
                    <Select
                      value={selectedScheme?.id || ""}
                      onValueChange={(v) => {
                        const s = schemes.find((s) => s.id === v) || null;
                        setSelectedScheme(s);
                        setSelectedExam(null);
                        setMarks({});
                        setExisting({});
                      }}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="Select scheme" />
                      </SelectTrigger>
                      <SelectContent>
                        {schemes.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedScheme && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Exam</p>
                      <Select
                        value={selectedExam?.id || ""}
                        onValueChange={(v) => {
                          const e = selectedScheme.exams.find((e) => e.id === v) || null;
                          setSelectedExam(e);
                          setMarks({});
                          setExisting({});
                        }}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Select exam" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedScheme.exams.map((e) => (
                            <SelectItem key={e.id} value={e.id}>{e.name} ({e.maxMarks})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Marks entry */}
            {selectedSection && selectedExam ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <div>
                      <span>Class {selectedSection.className} – Section {selectedSection.sectionName}</span>
                      <span className="text-gray-400 font-normal text-sm ml-2">· {selectedExam.name} (max {selectedExam.maxMarks})</span>
                    </div>
                    <Button onClick={submitMarks} disabled={saving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {saving ? "Saving..." : saved ? "Saved!" : "Submit Marks"}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {selectedSection.students.map((student) => (
                      <div key={student.id} className="flex items-center gap-4 py-2.5 px-4 rounded-lg border border-gray-100 hover:bg-gray-50">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700 shrink-0">
                          {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{student.name}</p>
                          <p className="text-xs text-gray-400">Roll: {student.rollNo}</p>
                        </div>
                        {existing[student.id] !== undefined && (
                          <Badge variant="secondary" className="text-xs">prev: {existing[student.id]}</Badge>
                        )}
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={selectedExam.maxMarks}
                            step={0.5}
                            className="w-20 text-center h-8"
                            placeholder="—"
                            value={marks[student.id] ?? ""}
                            onChange={(e) => setMarks((prev) => ({ ...prev, [student.id]: e.target.value }))}
                          />
                          <span className="text-xs text-gray-400 shrink-0">/ {selectedExam.maxMarks}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={submitMarks} disabled={saving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {saving ? "Saving..." : saved ? "Saved!" : "Submit Marks"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-gray-400">Select a section, scheme, and exam above to enter marks.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

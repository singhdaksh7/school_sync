"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { BookOpenCheck, CalendarDays, ClipboardCheck, FileText, GraduationCap, LogOut, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SubmissionStatus = "PENDING" | "SUBMITTED" | "NOT_SUBMITTED" | "LATE" | "CHECKED";
type HomeworkStatus = "ACTIVE" | "CLOSED" | "CANCELLED";

interface Student { id: string; name: string; rollNo: string }
interface Assignment {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  students: Student[];
}
interface HomeworkStudentStatus {
  id: string;
  studentId: string;
  status: SubmissionStatus;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  teacherRemark: string | null;
  student: Student;
}
interface Homework {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  dueDate: string;
  attachmentUrl: string | null;
  status: HomeworkStatus;
  section: { name: string; class: { name: string } };
  teacher: { name: string };
  studentStatuses: HomeworkStudentStatus[];
}
interface TeacherProfile { name: string; school: { name: string } }

const STATUS_OPTIONS: SubmissionStatus[] = ["SUBMITTED", "NOT_SUBMITTED", "LATE", "CHECKED"];
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  CLOSED: "bg-gray-50 text-gray-700 border-gray-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  NOT_SUBMITTED: "bg-red-50 text-red-700 border-red-200",
  LATE: "bg-orange-50 text-orange-700 border-orange-200",
  CHECKED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TeacherHomeworkPage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [selectedAssignmentKey, setSelectedAssignmentKey] = useState("");
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", attachmentUrl: "" });
  const [selectedHomeworkId, setSelectedHomeworkId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { status: SubmissionStatus; score: string; maxScore: string; teacherRemark: string }>>({});
  const [saving, setSaving] = useState(false);
  const [scoreSaving, setScoreSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadHomework() {
    const [profileRes, homeworkRes] = await Promise.all([
      fetch("/api/teacher/me"),
      fetch("/api/teacher/homework"),
    ]);
    const profileData = await profileRes.json();
    const homeworkData = await homeworkRes.json();
    if (!profileData.error) setProfile(profileData);
    if (!homeworkData.error) {
      setAssignments(homeworkData.assignments || []);
      setHomework(homeworkData.homework || []);
    } else {
      setMessage(homeworkData.error);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadHomework();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const selectedAssignment = useMemo(() => {
    return assignments.find((assignment) => `${assignment.sectionId}|${assignment.subject}` === selectedAssignmentKey) || null;
  }, [assignments, selectedAssignmentKey]);

  const selectedHomework = useMemo(() => {
    return homework.find((item) => item.id === selectedHomeworkId) || homework[0] || null;
  }, [homework, selectedHomeworkId]);

  useEffect(() => {
    if (!selectedHomework) return;
    const id = window.setTimeout(() => {
      const next: typeof scores = {};
      selectedHomework.studentStatuses.forEach((item) => {
        next[item.studentId] = {
          status: item.status === "PENDING" ? "SUBMITTED" : item.status,
          score: item.score === null ? "" : String(item.score),
          maxScore: item.maxScore === null ? "" : String(item.maxScore),
          teacherRemark: item.teacherRemark || "",
        };
      });
      setScores(next);
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectedHomework]);

  async function createHomework() {
    if (!selectedAssignment) {
      setMessage("Select a section and subject.");
      return;
    }
    if (!form.title.trim() || !form.dueDate) {
      setMessage("Title and due date are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    const res = await fetch("/api/teacher/homework", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId: selectedAssignment.sectionId,
        subject: selectedAssignment.subject,
        title: form.title,
        description: form.description,
        dueDate: form.dueDate,
        attachmentUrl: form.attachmentUrl,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error || "Could not create homework.");
      return;
    }
    setForm({ title: "", description: "", dueDate: "", attachmentUrl: "" });
    setSelectedAssignmentKey("");
    await loadHomework();
    setSelectedHomeworkId(data.id);
    setMessage("Homework created.");
  }

  async function updateHomeworkStatus(id: string, status: HomeworkStatus) {
    const res = await fetch(`/api/teacher/homework/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Could not update homework.");
      return;
    }
    await loadHomework();
    setMessage(status === "CLOSED" ? "Homework closed." : "Homework updated.");
  }

  async function saveScores() {
    if (!selectedHomework) return;
    const dueDate = new Date(selectedHomework.dueDate);
    if (new Date() < dueDate) {
      setMessage("Scores can be saved after the due date.");
      return;
    }

    setScoreSaving(true);
    setMessage("");
    const payload = selectedHomework.studentStatuses.map((item) => ({
      studentId: item.studentId,
      status: scores[item.studentId]?.status || "SUBMITTED",
      score: scores[item.studentId]?.score || null,
      maxScore: scores[item.studentId]?.maxScore || null,
      teacherRemark: scores[item.studentId]?.teacherRemark || null,
    }));

    const res = await fetch(`/api/teacher/homework/${selectedHomework.id}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: payload }),
    });
    const data = await res.json();
    setScoreSaving(false);
    if (!res.ok) {
      setMessage(data.error || "Could not save scores.");
      return;
    }
    await loadHomework();
    setMessage("Scores saved.");
  }

  const canScore = selectedHomework ? new Date() >= new Date(selectedHomework.dueDate) && selectedHomework.status !== "CANCELLED" : false;

  return (
    <div className="min-h-screen bg-gray-50">
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
          <Link href="/teacher/attendance"><Button variant="outline" size="sm" className="gap-2"><ClipboardCheck className="w-4 h-4" /> Attendance</Button></Link>
          <Link href="/teacher/marks"><Button variant="outline" size="sm" className="gap-2"><FileText className="w-4 h-4" /> Marks</Button></Link>
          <Link href="/teacher/timetable"><Button variant="outline" size="sm" className="gap-2"><CalendarDays className="w-4 h-4" /> Timetable</Button></Link>
          <Link href="/teacher/arrangements"><Button variant="outline" size="sm" className="gap-2"><RefreshCw className="w-4 h-4" /> Arrangements</Button></Link>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2 text-gray-500">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Homework</h1>
          <p className="text-sm text-gray-500 mt-1">Create and score homework for your assigned section and subject.</p>
        </div>
        {message && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Create Homework</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-5">
            <Select value={selectedAssignmentKey} onValueChange={setSelectedAssignmentKey}>
              <SelectTrigger><SelectValue placeholder="Section + subject" /></SelectTrigger>
              <SelectContent>
                {assignments.map((assignment) => (
                  <SelectItem key={`${assignment.sectionId}|${assignment.subject}`} value={`${assignment.sectionId}|${assignment.subject}`}>
                    Class {assignment.className}-{assignment.sectionName} · {assignment.subject}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
            <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
            <Input placeholder="Attachment URL" value={form.attachmentUrl} onChange={(e) => setForm((prev) => ({ ...prev, attachmentUrl: e.target.value }))} />
            <Button onClick={createHomework} disabled={saving || assignments.length === 0} className="gap-2">
              <BookOpenCheck className="w-4 h-4" /> {saving ? "Saving..." : "Assign"}
            </Button>
            <textarea
              className="md:col-span-5 min-h-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Homework List</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {homework.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">No homework assigned yet.</p>
              ) : homework.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedHomeworkId(item.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    selectedHomework?.id === item.id ? "border-blue-300 bg-blue-50" : "border-gray-100 bg-white hover:bg-gray-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-1">Class {item.section.class.name}-{item.section.name} · {item.subject}</p>
                      <p className="text-xs text-gray-400 mt-1">Due {formatDate(item.dueDate)}</p>
                    </div>
                    <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[item.status])}>{item.status}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{selectedHomework ? `Score: ${selectedHomework.title}` : "Score Homework"}</span>
                {selectedHomework && selectedHomework.status === "ACTIVE" && (
                  <Button variant="outline" size="sm" onClick={() => updateHomeworkStatus(selectedHomework.id, "CLOSED")}>Close</Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedHomework ? (
                <p className="text-sm text-gray-500 py-12 text-center">Select homework to score.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                    <Badge variant="outline" className={cn(STATUS_COLORS[selectedHomework.status])}>{selectedHomework.status}</Badge>
                    <span>Class {selectedHomework.section.class.name}-{selectedHomework.section.name}</span>
                    <span>·</span>
                    <span>{selectedHomework.subject}</span>
                    <span>·</span>
                    <span>Due {formatDate(selectedHomework.dueDate)}</span>
                  </div>
                  {!canScore && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Scoring opens after the due date and is disabled for cancelled homework.</p>}
                  <div className="space-y-2">
                    {selectedHomework.studentStatuses.map((item) => (
                      <div key={item.id} className="grid gap-2 rounded-lg border border-gray-100 p-3 md:grid-cols-[1fr_150px_90px_90px_1fr] md:items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{item.student.name}</p>
                          <p className="text-xs text-gray-400">Roll {item.student.rollNo}</p>
                        </div>
                        <Select
                          value={scores[item.studentId]?.status || "SUBMITTED"}
                          onValueChange={(value) => setScores((prev) => ({ ...prev, [item.studentId]: { ...prev[item.studentId], status: value as SubmissionStatus } }))}
                          disabled={!canScore}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input disabled={!canScore} type="number" min={0} placeholder="Score" value={scores[item.studentId]?.score || ""} onChange={(e) => setScores((prev) => ({ ...prev, [item.studentId]: { ...prev[item.studentId], score: e.target.value } }))} />
                        <Input disabled={!canScore} type="number" min={0} placeholder="Max" value={scores[item.studentId]?.maxScore || ""} onChange={(e) => setScores((prev) => ({ ...prev, [item.studentId]: { ...prev[item.studentId], maxScore: e.target.value } }))} />
                        <Input disabled={!canScore} placeholder="Remark" value={scores[item.studentId]?.teacherRemark || ""} onChange={(e) => setScores((prev) => ({ ...prev, [item.studentId]: { ...prev[item.studentId], teacherRemark: e.target.value } }))} />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={saveScores} disabled={!canScore || scoreSaving} className="gap-2">
                      <Save className="w-4 h-4" /> {scoreSaving ? "Saving..." : "Save Scores"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

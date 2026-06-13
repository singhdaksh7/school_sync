"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, CalendarClock, CheckCircle2, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type HomeworkStatus = "ACTIVE" | "CLOSED" | "CANCELLED";

interface ClassItem {
  id: string;
  name: string;
  sections: { id: string; name: string; classId: string }[];
}
interface TeacherItem { id: string; name: string; subject: string | null }
interface Assignment {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
}
interface AssignmentGroup {
  teacherId: string;
  teacherName: string;
  assignments: Assignment[];
}
interface Homework {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  dueDate: string;
  status: HomeworkStatus;
  teacher: { id: string; name: string; subject: string | null };
  section: { id: string; name: string; class: { id: string; name: string } };
  studentStatuses: { status: string; score: number | null }[];
}

const STATUS_COLORS: Record<HomeworkStatus, string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  CLOSED: "bg-gray-50 text-gray-700 border-gray-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toDeadlineIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

interface Props {
  schoolId: string;
  initialHomework: Homework[];
  initialClasses: ClassItem[];
  initialTeachers: TeacherItem[];
  initialAssignmentsByTeacher: AssignmentGroup[];
}

export default function HomeworkClient({
  schoolId,
  initialHomework,
  initialClasses,
  initialTeachers,
  initialAssignmentsByTeacher,
}: Props) {
  const [homework, setHomework] = useState(initialHomework);
  const [assignmentsByTeacher, setAssignmentsByTeacher] = useState(initialAssignmentsByTeacher);
  const [filters, setFilters] = useState({ classId: "all", sectionId: "all", subject: "all", teacherId: "all", status: "all" });
  const [form, setForm] = useState({ assignmentKey: "", title: "", description: "", dueDate: "", attachmentUrl: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/schools/${schoolId}/homework`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Could not load homework.");
      return;
    }
    setHomework(data.homework || []);
    setAssignmentsByTeacher(data.assignmentsByTeacher || []);
  }

  const assignmentOptions = useMemo(() => {
    return assignmentsByTeacher.flatMap((group) =>
      group.assignments.map((assignment) => ({
        key: `${group.teacherId}|${assignment.sectionId}|${assignment.subject}`,
        teacherId: group.teacherId,
        teacherName: group.teacherName,
        ...assignment,
      }))
    );
  }, [assignmentsByTeacher]);

  const subjects = useMemo(() => {
    return [...new Set(homework.map((item) => item.subject))].sort();
  }, [homework]);

  const visibleSections = useMemo(() => {
    return initialClasses
      .filter((cls) => filters.classId === "all" || cls.id === filters.classId)
      .flatMap((cls) => cls.sections.map((section) => ({ ...section, className: cls.name })));
  }, [filters.classId, initialClasses]);

  const filteredHomework = useMemo(() => {
    return homework.filter((item) => {
      return (
        (filters.classId === "all" || item.section.class.id === filters.classId) &&
        (filters.sectionId === "all" || item.section.id === filters.sectionId) &&
        (filters.subject === "all" || item.subject === filters.subject) &&
        (filters.teacherId === "all" || item.teacher.id === filters.teacherId) &&
        (filters.status === "all" || item.status === filters.status)
      );
    });
  }, [filters, homework]);

  const summary = {
    active: homework.filter((item) => item.status === "ACTIVE").length,
    closed: homework.filter((item) => item.status === "CLOSED").length,
    total: homework.length,
  };

  async function createHomework() {
    const selected = assignmentOptions.find((option) => option.key === form.assignmentKey);
    if (!selected) {
      setMessage("Choose a valid teacher, section, and subject.");
      return;
    }
    if (!form.title.trim() || !form.dueDate) {
      setMessage("Title and due date are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/schools/${schoolId}/homework`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherId: selected.teacherId,
        sectionId: selected.sectionId,
        subject: selected.subject,
        title: form.title,
        description: form.description,
        dueDate: toDeadlineIso(form.dueDate),
        attachmentUrl: form.attachmentUrl,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error || "Could not create homework.");
      return;
    }
    setForm({ assignmentKey: "", title: "", description: "", dueDate: "", attachmentUrl: "" });
    await refresh();
    setMessage("Homework created.");
  }

  async function updateStatus(homeworkId: string, status: HomeworkStatus) {
    const res = await fetch(`/api/schools/${schoolId}/homework/${homeworkId}`, {
      method: status === "CANCELLED" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: status === "CANCELLED" ? undefined : JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Could not update homework.");
      return;
    }
    await refresh();
    setMessage(status === "CANCELLED" ? "Homework cancelled." : "Homework updated.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Homework</h2>
          <p className="text-sm text-gray-500 mt-1">Monitor assignments, due dates, submissions, and teacher scoring.</p>
        </div>
        <Button onClick={createHomework} disabled={saving || assignmentOptions.length === 0} className="gap-2">
          <Plus className="w-4 h-4" /> {saving ? "Saving..." : "Create"}
        </Button>
      </div>

      {message && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Active", value: summary.active, icon: BookOpenCheck, color: "bg-green-100 text-green-700" },
          { label: "Total", value: summary.total, icon: CalendarClock, color: "bg-amber-100 text-amber-700" },
          { label: "Closed", value: summary.closed, icon: CheckCircle2, color: "bg-blue-100 text-blue-700" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", item.color)}>
                  <item.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-xl font-bold text-gray-900">{item.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Create Homework</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-5">
          <Select value={form.assignmentKey} onValueChange={(value) => setForm((prev) => ({ ...prev, assignmentKey: value }))}>
            <SelectTrigger className="lg:col-span-2"><SelectValue placeholder="Teacher · class-section · subject" /></SelectTrigger>
            <SelectContent>
              {assignmentOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.teacherName} · Class {option.className}-{option.sectionName} · {option.subject}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
          <Input placeholder="Attachment URL" value={form.attachmentUrl} onChange={(e) => setForm((prev) => ({ ...prev, attachmentUrl: e.target.value }))} />
          <textarea
            className="lg:col-span-5 min-h-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Select value={filters.classId} onValueChange={(value) => setFilters((prev) => ({ ...prev, classId: value, sectionId: "all" }))}>
            <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {initialClasses.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.sectionId} onValueChange={(value) => setFilters((prev) => ({ ...prev, sectionId: value }))}>
            <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {visibleSections.map((section) => <SelectItem key={section.id} value={section.id}>{section.className}-{section.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.subject} onValueChange={(value) => setFilters((prev) => ({ ...prev, subject: value }))}>
            <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjects.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.teacherId} onValueChange={(value) => setFilters((prev) => ({ ...prev, teacherId: value }))}>
            <SelectTrigger><SelectValue placeholder="Teacher" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teachers</SelectItem>
              {initialTeachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {(["ACTIVE", "CLOSED", "CANCELLED"] as HomeworkStatus[]).map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Homework Overview ({filteredHomework.length})</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {filteredHomework.length === 0 ? (
            <div className="py-16 text-center">
              <XCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No homework matches these filters.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHomework.map((item) => {
                const checked = item.studentStatuses.filter((student) => student.status === "CHECKED").length;
                const submitted = item.studentStatuses.filter((student) => student.status === "SUBMITTED" || student.status === "LATE" || student.status === "CHECKED").length;
                return (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900">{item.title}</p>
                        <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[item.status])}>{item.status}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Class {item.section.class.name}-{item.section.name} · {item.subject} · {item.teacher.name} · Due {formatDate(item.dueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs text-gray-500">
                        <p>{submitted}/{item.studentStatuses.length} submitted</p>
                        <p>{checked}/{item.studentStatuses.length} checked</p>
                      </div>
                      {item.status === "ACTIVE" && (
                        <Button variant="outline" size="sm" onClick={() => updateStatus(item.id, "CLOSED")}>Close</Button>
                      )}
                      {item.status !== "CANCELLED" && (
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => updateStatus(item.id, "CANCELLED")}>Cancel</Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

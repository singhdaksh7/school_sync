"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, CalendarClock, CheckCircle2, Plus, XCircle, Paperclip } from "lucide-react";
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
interface StudentStatus {
  id: string;
  studentId: string;
  status: string;
}
interface Homework {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  deadlineAt: string;
  status: HomeworkStatus;
  subject: string;
  teacher: { id: string; name: string };
  section: { id: string; name: string; class: { id: string; name: string } };
  attachmentUrl: string | null;
  attachmentFileId: string | null;
  studentStatuses: StudentStatus[];
}

interface Props {
  schoolId: string;
  initialHomework: Homework[];
  initialClasses: ClassItem[];
  initialTeachers: TeacherItem[];
  initialAssignmentsByTeacher: AssignmentGroup[];
}

const STATUS_COLORS: Record<HomeworkStatus, string> = {
  ACTIVE: "bg-green-150 text-green-800 border-green-200",
  CLOSED: "bg-gray-150 text-gray-800 border-gray-200",
  CANCELLED: "bg-red-150 text-red-800 border-red-200",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function toDeadlineIso(value: string) {
  const withTime = value.includes("T") ? value : `${value}T23:59:00`;
  const date = new Date(withTime);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
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
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
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
    return Array.from(new Set(homework.map((item) => item.subject))).sort();
  }, [homework]);

  const filteredHomework = useMemo(() => {
    return homework.filter((item) => {
      if (filters.classId !== "all" && item.section.class.id !== filters.classId) return false;
      if (filters.sectionId !== "all" && item.section.id !== filters.sectionId) return false;
      if (filters.subject !== "all" && item.subject !== filters.subject) return false;
      if (filters.teacherId !== "all" && item.teacher.id !== filters.teacherId) return false;
      if (filters.status !== "all" && item.status !== filters.status) return false;
      return true;
    });
  }, [homework, filters]);

  const activeCount = useMemo(() => homework.filter((h) => h.status === "ACTIVE").length, [homework]);
  const closedCount = useMemo(() => homework.filter((h) => h.status === "CLOSED").length, [homework]);

  async function submitHomework() {
    const selected = assignmentOptions.find((o) => o.key === form.assignmentKey);
    if (!selected) {
      setMessage("Select a class assignment first.");
      return;
    }
    if (!form.title.trim() || !form.dueDate) {
      setMessage("Title and due date are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
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
      if (!res.ok) {
        setMessage(data.error || "Could not create homework.");
        setSaving(false);
        return;
      }

      const homeworkId = data.homework.id;

      // Handle file upload if present
      if (attachmentFile && homeworkId) {
        setUploadingAttachment(true);
        const formData = new FormData();
        formData.append("file", attachmentFile);
        
        const fileRes = await fetch(`/api/schools/${schoolId}/homework/${homeworkId}/attachment`, {
          method: "POST",
          body: formData,
        });
        const fileData = await fileRes.json();
        setUploadingAttachment(false);

        if (!fileRes.ok) {
          if (fileData.error === "UPLOAD_QUOTA_EXCEEDED") {
            setMessage("Homework metadata created, but attachment upload failed because the upload quota has been exceeded.");
          } else {
            setMessage(`Homework created, but attachment upload failed: ${fileData.error}`);
          }
        }
      }

      setForm({ assignmentKey: "", title: "", description: "", dueDate: "", attachmentUrl: "" });
      setAttachmentFile(null);
      await refresh();
      if (!message) setMessage("Homework created successfully.");
    } catch (e) {
      setMessage("Network connection failed.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(homeworkId: string, status: HomeworkStatus) {
    const res = await fetch(`/api/schools/${schoolId}/homework/${homeworkId}`, {
      method: status === "CANCELLED" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: status === "CANCELLED" ? undefined : JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to update status.");
      return;
    }
    await refresh();
  }

  const sectionsForClassFilter = useMemo(() => {
    const cls = initialClasses.find((c) => c.id === filters.classId);
    return cls?.sections || [];
  }, [filters.classId, initialClasses]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <BookOpenCheck className="w-6 h-6 text-blue-600" />
          Homework Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure assignments, track completion, and upload files.</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { title: "Total Assigned", value: homework.length, icon: BookOpenCheck },
          { title: "Active Tasks", value: activeCount, icon: CalendarClock },
          { title: "Archived/Closed", value: closedCount, icon: CheckCircle2 }
        ].map((item, idx) => (
          <Card key={idx} className="border-border/60 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">{item.title}</p>
                <p className="text-2xl font-extrabold mt-1 text-gray-900">{item.value}</p>
              </div>
              <item.icon className="w-8 h-8 text-gray-400 shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create form */}
      <Card className="border border-gray-150 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create Assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <p className={cn("text-xs p-2 rounded-lg border", message.includes("success") || message.includes("created") ? "bg-green-50 text-green-800 border-green-200" : "bg-red-50 text-red-800 border-red-200")}>
              {message}
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-5">
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
            
            <Input aria-label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
            
            {/* Managed attachment file input */}
            <div className="flex flex-col gap-1">
              <Input 
                type="file" 
                className="text-xs h-9" 
                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)} 
              />
            </div>

            <textarea
              className="lg:col-span-5 min-h-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={submitHomework} disabled={saving || uploadingAttachment} className="gap-2">
              {saving ? "Saving..." : uploadingAttachment ? "Uploading file..." : "Assign Homework"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="border border-gray-150 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Filter Assignments</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={filters.classId} onValueChange={(value) => setFilters((prev) => ({ ...prev, classId: value, sectionId: "all" }))}>
            <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {initialClasses.map((cls) => <SelectItem key={cls.id} value={cls.id}>Class {cls.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.sectionId} onValueChange={(value) => setFilters((prev) => ({ ...prev, sectionId: value }))} disabled={filters.classId === "all"}>
            <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {sectionsForClassFilter.map((sec) => <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>)}
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

      {/* List */}
      <Card className="border border-gray-150 shadow-sm">
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
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3.5 hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900">{item.title}</p>
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5", STATUS_COLORS[item.status])}>{item.status}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mt-1">
                        <span>Class {item.section.class.name}-{item.section.name}</span>
                        <span>·</span>
                        <span>{item.subject}</span>
                        <span>·</span>
                        <span>{item.teacher.name}</span>
                        <span>·</span>
                        <span>Due {formatDate(item.deadlineAt)}</span>
                        
                        {/* Render attachment badge or info */}
                        {item.attachmentUrl ? (
                          <>
                            <span>·</span>
                            <a href={item.attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 font-semibold hover:underline">
                              <Paperclip className="w-3 h-3" /> Attachment
                            </a>
                          </>
                        ) : item.attachmentFileId ? (
                          <>
                            <span>·</span>
                            <span className="text-gray-400 italic">Attachment expired/deleted</span>
                          </>
                        ) : null}
                      </div>
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

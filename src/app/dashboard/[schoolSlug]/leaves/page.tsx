"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ClipboardList, Plus, Check, X, Trash2, Users, GraduationCap, CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format, differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";

interface Arrangement {
  id: string;
  date: string;
  period: number;
  subject: string | null;
  substituteTeacher: { name: string } | null;
  section: { name: string; class: { name: string } };
}

interface LeaveRequest {
  id: string;
  type: "STUDENT" | "TEACHER";
  reason: string;
  fromDate: string;
  toDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  student: { name: string; rollNo: string; section: { name: string; class: { name: string } } } | null;
  teacher: { name: string; subject: string | null } | null;
  reviewedBy: { name: string } | null;
}

interface Student { id: string; name: string; rollNo: string; section: { name: string; class: { name: string } } }
interface Teacher { id: string; name: string; subject: string | null }

type EntityTab = "STUDENT" | "TEACHER";
type StatusTab = "PENDING" | "APPROVED" | "REJECTED";

const STATUS_CONFIG = {
  PENDING: { label: "Pending", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  APPROVED: { label: "Approved", color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "Rejected", color: "bg-red-50 text-red-700 border-red-200" },
};

export default function LeavesPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityTab, setEntityTab] = useState<EntityTab>("STUDENT");
  const [statusTab, setStatusTab] = useState<StatusTab>("PENDING");

  const [arrangements, setArrangements] = useState<Record<string, Arrangement[]>>({});
  const [expandedLeave, setExpandedLeave] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ type: "STUDENT" as EntityTab, studentId: "", teacherId: "", reason: "", fromDate: "", toDate: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetchAll(d.id);
    });
  }, [schoolSlug]);

  const fetchAll = useCallback(async (sid: string) => {
    setLoading(true);
    const [leavesRes, studRes, teachRes] = await Promise.all([
      fetch(`/api/schools/${sid}/leaves`),
      fetch(`/api/schools/${sid}/students`),
      fetch(`/api/schools/${sid}/teachers`),
    ]);
    setLeaves(await leavesRes.json());
    setStudents(await studRes.json());
    setTeachers(await teachRes.json());
    setLoading(false);
  }, []);

  async function save() {
    const target = form.type === "STUDENT" ? form.studentId : form.teacherId;
    if (!target || !form.reason.trim() || !form.fromDate || !form.toDate) {
      setError("All fields are required"); return;
    }
    if (form.toDate < form.fromDate) { setError("To date must be after from date"); return; }
    setSaving(true); setError("");
    const res = await fetch(`/api/schools/${schoolId}/leaves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        reason: form.reason,
        fromDate: form.fromDate,
        toDate: form.toDate,
        studentId: form.type === "STUDENT" ? form.studentId : undefined,
        teacherId: form.type === "TEACHER" ? form.teacherId : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    fetchAll(schoolId);
    setSaving(false);
  }

  async function updateStatus(id: string, status: "APPROVED" | "REJECTED") {
    await fetch(`/api/schools/${schoolId}/leaves/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchAll(schoolId);
  }

  async function fetchArrangements(leaveId: string) {
    if (expandedLeave === leaveId) { setExpandedLeave(null); return; }
    setExpandedLeave(leaveId);
    if (arrangements[leaveId]) return; // already loaded
    const res = await fetch(`/api/schools/${schoolId}/arrangements?leaveRequestId=${leaveId}`);
    const data = await res.json();
    setArrangements((prev) => ({ ...prev, [leaveId]: data }));
  }

  async function deleteLeave(id: string) {
    if (!confirm("Delete this leave request?")) return;
    await fetch(`/api/schools/${schoolId}/leaves/${id}`, { method: "DELETE" });
    fetchAll(schoolId);
  }

  const filtered = leaves.filter((l) => l.type === entityTab && l.status === statusTab);
  const pendingCount = leaves.filter((l) => l.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Leave Management</h2>
          <p className="text-sm text-gray-500 mt-1">
            {pendingCount > 0 ? `${pendingCount} pending request${pendingCount > 1 ? "s" : ""}` : "No pending requests"}
          </p>
        </div>
        <Button onClick={() => { setForm({ type: "STUDENT", studentId: "", teacherId: "", reason: "", fromDate: "", toDate: "" }); setError(""); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Add Leave Request
        </Button>
      </div>

      {/* Entity tabs */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit">
        {(["STUDENT", "TEACHER"] as EntityTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setEntityTab(t)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
              entityTab === t ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            )}
          >
            {t === "STUDENT" ? <GraduationCap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {t === "STUDENT" ? "Students" : "Teachers"}
          </button>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex border-b border-gray-200">
        {(["PENDING", "APPROVED", "REJECTED"] as StatusTab[]).map((s) => {
          const count = leaves.filter((l) => l.type === entityTab && l.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setStatusTab(s)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                statusTab === s ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              {s}
              {count > 0 && (
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-semibold",
                  s === "PENDING" ? "bg-yellow-100 text-yellow-700" : s === "APPROVED" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No {statusTab.toLowerCase()} leave requests</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => {
            const person = l.type === "STUDENT" ? l.student : l.teacher;
            const days = differenceInCalendarDays(new Date(l.toDate), new Date(l.fromDate)) + 1;
            return (
              <Card key={l.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3 flex-1 min-w-0">
                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0",
                        l.type === "STUDENT" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {person?.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{person?.name}</p>
                          {l.type === "STUDENT" && l.student && (
                            <span className="text-xs text-gray-400">{l.student.section.class.name}-{l.student.section.name} · Roll {l.student.rollNo}</span>
                          )}
                          {l.type === "TEACHER" && l.teacher?.subject && (
                            <span className="text-xs text-gray-400">{l.teacher.subject}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{l.reason}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                          <span>{format(new Date(l.fromDate), "dd MMM")} → {format(new Date(l.toDate), "dd MMM yyyy")}</span>
                          <span className="font-medium text-gray-500">{days} day{days > 1 ? "s" : ""}</span>
                          {l.reviewedBy && <span>Reviewed by {l.reviewedBy.name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline" className={cn("text-xs", STATUS_CONFIG[l.status].color)}>
                        {STATUS_CONFIG[l.status].label}
                      </Badge>
                      {l.status === "PENDING" && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50" title="Approve" onClick={() => updateStatus(l.id, "APPROVED")}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" title="Reject" onClick={() => updateStatus(l.id, "REJECTED")}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-500" onClick={() => deleteLeave(l.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>

                {/* Arrangement details — only for approved teacher leaves */}
                {l.status === "APPROVED" && l.type === "TEACHER" && (
                  <>
                    <button
                      onClick={() => fetchArrangements(l.id)}
                      className="w-full flex items-center justify-between px-5 py-2 border-t border-gray-100 text-xs text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5" />
                        View Arrangements
                      </span>
                      {expandedLeave === l.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {expandedLeave === l.id && (
                      <div className="px-5 pb-4 border-t border-gray-100 bg-gray-50">
                        {!arrangements[l.id] ? (
                          <p className="text-xs text-gray-400 py-3">Loading...</p>
                        ) : arrangements[l.id].length === 0 ? (
                          <p className="text-xs text-gray-400 py-3">No arrangements created — teacher may have no timetable slots on leave days.</p>
                        ) : (
                          <div className="space-y-1.5 pt-3">
                            {arrangements[l.id]
                              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.period - b.period)
                              .map((arr) => (
                                <div key={arr.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-200">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-gray-700">{format(new Date(arr.date), "dd MMM")} · P{arr.period}</span>
                                    <span className="text-gray-500">
                                      {arr.section.class.name}-{arr.section.name}
                                      {arr.subject ? ` · ${arr.subject}` : ""}
                                    </span>
                                  </div>
                                  {arr.substituteTeacher ? (
                                    <span className="text-green-700 font-medium">{arr.substituteTeacher.name}</span>
                                  ) : (
                                    <span className="text-orange-500 font-medium">No substitute found</span>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Leave Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["STUDENT", "TEACHER"] as EntityTab[]).map((t) => (
                  <button key={t} onClick={() => setForm({ ...form, type: t, studentId: "", teacherId: "" })}
                    className={cn("flex-1 py-2 text-sm font-medium transition-colors",
                      form.type === t ? "bg-blue-600 text-white" : "bg-white text-gray-600"
                    )}>
                    {t === "STUDENT" ? "Student" : "Teacher"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{form.type === "STUDENT" ? "Student" : "Teacher"} *</Label>
              {form.type === "STUDENT" ? (
                <Select value={form.studentId} onValueChange={(v) => setForm({ ...form, studentId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} ({s.section.class.name}-{s.section.name})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={form.teacherId} onValueChange={(v) => setForm({ ...form, teacherId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
                  <SelectContent>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}{t.subject ? ` (${t.subject})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From *</Label>
                <input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="space-y-1.5">
                <Label>To *</Label>
                <input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <textarea
                className="w-full min-h-[80px] px-3 py-2 rounded-md border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Reason for leave..."
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shield, User, BookOpen, IndianRupee, ClipboardList, Megaphone, CalendarOff, GraduationCap, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string | null; email: string | null };
}

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  STUDENT_CREATED: { label: "Student Created", color: "bg-green-100 text-green-700" },
  STUDENT_UPDATED: { label: "Student Updated", color: "bg-blue-100 text-blue-700" },
  STUDENT_DELETED: { label: "Student Deleted", color: "bg-red-100 text-red-700" },
  STUDENT_TRANSFERRED: { label: "Student Transferred", color: "bg-purple-100 text-purple-700" },
  TEACHER_CREATED: { label: "Teacher Created", color: "bg-green-100 text-green-700" },
  TEACHER_DELETED: { label: "Teacher Deleted", color: "bg-red-100 text-red-700" },
  MARKS_SUBMITTED: { label: "Marks Submitted", color: "bg-amber-100 text-amber-700" },
  LEAVE_APPROVED: { label: "Leave Approved", color: "bg-green-100 text-green-700" },
  LEAVE_REJECTED: { label: "Leave Rejected", color: "bg-red-100 text-red-700" },
  FEE_PAYMENT_RECORDED: { label: "Fee Payment", color: "bg-indigo-100 text-indigo-700" },
  ANNOUNCEMENT_CREATED: { label: "Announcement Created", color: "bg-teal-100 text-teal-700" },
  ANNOUNCEMENT_DELETED: { label: "Announcement Deleted", color: "bg-red-100 text-red-700" },
  HOLIDAY_CREATED: { label: "Holiday Created", color: "bg-orange-100 text-orange-700" },
  HOLIDAY_DELETED: { label: "Holiday Deleted", color: "bg-red-100 text-red-700" },
};

const ENTITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Student: GraduationCap,
  Teacher: User,
  FeePayment: IndianRupee,
  LeaveRequest: ClipboardList,
  Announcement: Megaphone,
  Holiday: CalendarOff,
  ExamResult: BookOpen,
};

const ALL_ACTIONS = Object.keys(ACTION_CONFIG);
const ENTITY_TYPES = ["Student", "Teacher", "FeePayment", "LeaveRequest", "Announcement", "Holiday", "ExamResult"];

function formatMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.name) parts.push(String(meta.name));
  if (meta.studentName) parts.push(String(meta.studentName));
  if (meta.amount) parts.push(`₹${meta.amount}`);
  if (meta.feeName) parts.push(String(meta.feeName));
  if (meta.rollNo) parts.push(`Roll: ${meta.rollNo}`);
  return parts.join(" · ");
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AuditLogsPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;

  const [schoolId, setSchoolId] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");

  const fetchLogs = (sid: string) => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filterAction) q.set("action", filterAction);
    if (filterEntity) q.set("entityType", filterEntity);
    q.set("limit", "100");
    fetch(`/api/schools/${sid}/audit-logs?${q}`)
      .then((r) => r.json())
      .then((d) => { setLogs(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`)
      .then((r) => r.json())
      .then((d) => { setSchoolId(d.id); fetchLogs(d.id); });
  }, [schoolSlug]);

  // Re-fetch when filters change (only after schoolId is set)
  useEffect(() => {
    if (schoolId) fetchLogs(schoolId);
  }, [filterAction, filterEntity]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-gray-400" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Audit Logs</h2>
          <p className="text-sm text-gray-500 mt-0.5">Track all administrative actions in your school</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Types</option>
          {ENTITY_TYPES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Actions</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_CONFIG[a]?.label || a}</option>
          ))}
        </select>
        {(filterAction || filterEntity) && (
          <button
            onClick={() => { setFilterAction(""); setFilterEntity(""); }}
            className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Clear
          </button>
        )}
        <span className="text-sm text-gray-400 ml-auto self-center">{logs.length} entries</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No audit logs yet</p>
            <p className="text-sm text-gray-400 mt-1">Actions like student creation, fee payments, and leave approvals will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0 divide-y divide-gray-50">
              {logs.map((log) => {
                const cfg = ACTION_CONFIG[log.action] || { label: log.action, color: "bg-gray-100 text-gray-600" };
                const Icon = ENTITY_ICON[log.entityType] || Shield;
                const meta = formatMeta(log.metadata);
                return (
                  <div key={log.id} className="py-3.5 flex items-start gap-3">
                    <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={cn("text-xs border-0", cfg.color)}>{cfg.label}</Badge>
                        {meta && <span className="text-sm text-gray-700 font-medium truncate">{meta}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                          by <span className="font-medium text-gray-500">{log.user?.name || log.user?.email || "Unknown"}</span>
                        </span>
                        <span className="text-gray-200">·</span>
                        <span className="text-xs text-gray-400" title={new Date(log.createdAt).toLocaleString()}>
                          {timeAgo(log.createdAt)}
                        </span>
                        <span className="text-gray-200">·</span>
                        <span className="text-xs text-gray-300 font-mono truncate">{log.entityType}:{log.entityId.slice(-6)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { ClipboardList, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface LeaveRequest {
  id: string;
  reason: string;
  fromDate: string;
  toDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedBy: { name: string } | null;
}

const LEAVE_TYPES = ["Sick Leave", "Casual Leave", "Family Function", "Medical Appointment", "Other"];

const STATUS_CONFIG: Record<LeaveRequest["status"], { label: string; variant: "warning" | "success" | "destructive" }> = {
  PENDING: { label: "Pending", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

function todayStr() {
  return format(new Date(), "yyyy-MM-dd");
}

function sameDayCutoffPassed() {
  const now = new Date();
  return now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() >= 30);
}

export default function StudentLeavePage() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leaveType: LEAVE_TYPES[0], reason: "", fromDate: "", toDate: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchLeaves = useCallback(() => {
    setLoading(true);
    fetch("/api/student/leave")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setLeaves(d.leaves || []); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(fetchLeaves, 0);
    return () => window.clearTimeout(id);
  }, [fetchLeaves]);

  const sameDayBlocked = form.fromDate === todayStr() && sameDayCutoffPassed();

  async function submit() {
    if (!form.reason.trim() || !form.fromDate || !form.toDate) {
      setError("All fields are required."); return;
    }
    if (form.toDate < form.fromDate) { setError("To date must be on or after from date."); return; }
    if (sameDayBlocked) { setError("Same-day leave can only be requested before 7:30 AM. Please choose a future date."); return; }

    setSaving(true); setError("");
    const res = await fetch("/api/student/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed to submit."); setSaving(false); return; }
    setShowForm(false);
    setForm({ leaveType: LEAVE_TYPES[0], reason: "", fromDate: "", toDate: "" });
    fetchLeaves();
    setSaving(false);
  }

  const pending = leaves.filter((l) => l.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Leave Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending > 0 ? `${pending} request${pending > 1 ? "s" : ""} pending approval` : "Submit a request and your school will review it"}
          </p>
        </div>
        <Button onClick={() => { setShowForm(true); setError(""); }} className="gap-2">
          <Plus className="h-4 w-4" /> Request Leave
        </Button>
      </div>

      {showForm && (
        <Card className="border-border">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">New Leave Request</p>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Leave Type *</label>
              <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">From *</label>
                <input
                  type="date"
                  min={todayStr()}
                  value={form.fromDate}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">To *</label>
                <input
                  type="date"
                  min={form.fromDate || todayStr()}
                  value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            {sameDayBlocked && (
              <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300">
                Same-day leave can only be requested before 7:30 AM. Please choose a future date.
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Reason *</label>
              <Textarea
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Briefly describe the reason for your leave..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : leaves.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-foreground">No leave requests yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Click &quot;Request Leave&quot; to submit one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {leaves.map((l) => {
            const days = differenceInCalendarDays(new Date(l.toDate), new Date(l.fromDate)) + 1;
            const cfg = STATUS_CONFIG[l.status];
            return (
              <Card key={l.id} className={cn("border-border transition-shadow hover:shadow-sm")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{l.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{format(new Date(l.fromDate), "dd MMM")} → {format(new Date(l.toDate), "dd MMM yyyy")}</span>
                        <span className="font-medium">{days} day{days > 1 ? "s" : ""}</span>
                        <span>Submitted {format(new Date(l.createdAt), "dd MMM yyyy")}</span>
                        {l.reviewedBy && <span>Reviewed by <span className="font-medium">{l.reviewedBy.name}</span></span>}
                      </div>
                    </div>
                    <Badge variant={cfg.variant} className="flex-shrink-0">{cfg.label}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

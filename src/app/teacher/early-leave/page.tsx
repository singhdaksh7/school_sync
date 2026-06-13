"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  GraduationCap, LogOut, CalendarDays, ClipboardCheck, FileText,
  RefreshCw, BookOpenCheck, DoorOpen, Send, Check, X, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Status = "PENDING" | "APPROVED" | "REJECTED";

interface EarlyLeave {
  id: string;
  date: string;
  leaveAfterPeriod: number;
  reason: string;
  status: Status;
  approvedBy: { name: string } | null;
  createdAt: string;
}

interface TeacherProfile {
  id: string;
  name: string;
  school: { name: string };
}

const STATUS_CONFIG: Record<Status, { label: string; icon: typeof Check; color: string }> = {
  PENDING: { label: "Pending", icon: Clock, color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  APPROVED: { label: "Approved", icon: Check, color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "Rejected", icon: X, color: "bg-red-50 text-red-700 border-red-200" },
};

export default function TeacherEarlyLeavePage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [requests, setRequests] = useState<EarlyLeave[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [leaveAfterPeriod, setLeaveAfterPeriod] = useState(1);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchRequests = useCallback(() => {
    setLoading(true);
    fetch("/api/teacher/early-leave")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setRequests(d); setLoading(false); });
  }, []);

  useEffect(() => {
    fetch("/api/teacher/me").then((r) => r.json()).then((d) => { if (!d.error) setProfile(d); });
    fetch("/api/teacher/timetable").then((r) => r.json()).then((d) => {
      if (d?.periodsPerDay) setPeriodsPerDay(d.periodsPerDay);
    });
    const id = window.setTimeout(fetchRequests, 0);
    return () => window.clearTimeout(id);
  }, [fetchRequests]);

  async function submit() {
    setSubmitting(true);
    setMessage("");
    setError("");
    const res = await fetch("/api/teacher/early-leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, leaveAfterPeriod, reason }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setMessage("Early-leave request submitted. Substitutes are assigned once an admin approves it.");
      setReason("");
      fetchRequests();
      return;
    }
    setError(data.error || "Unable to submit request");
  }

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
        <div className="flex items-center gap-2">
          {profile && (
            <div className="text-right hidden sm:block mr-2">
              <p className="text-sm font-medium text-gray-800">{profile.name}</p>
              <p className="text-xs text-gray-400">Teacher Portal</p>
            </div>
          )}
          <Link href="/teacher/timetable">
            <Button variant="outline" size="sm" className="gap-2"><CalendarDays className="w-4 h-4" /> Timetable</Button>
          </Link>
          <Link href="/teacher/attendance">
            <Button variant="outline" size="sm" className="gap-2"><ClipboardCheck className="w-4 h-4" /> Attendance</Button>
          </Link>
          <Link href="/teacher/arrangements">
            <Button variant="outline" size="sm" className="gap-2"><RefreshCw className="w-4 h-4" /> Arrangements</Button>
          </Link>
          <Link href="/teacher/marks">
            <Button variant="outline" size="sm" className="gap-2"><FileText className="w-4 h-4" /> Marks</Button>
          </Link>
          <Link href="/teacher/homework">
            <Button variant="outline" size="sm" className="gap-2"><BookOpenCheck className="w-4 h-4" /> Homework</Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2 text-gray-500">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DoorOpen className="w-6 h-6 text-blue-600" /> Early Leave
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Request to leave after a chosen period. Once approved, your remaining periods are auto-substituted.
          </p>
        </div>

        {/* Request form */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">New Request</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</p>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Leave after period</p>
                <select
                  value={leaveAfterPeriod}
                  onChange={(e) => setLeaveAfterPeriod(Number(e.target.value))}
                  className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>After Period {p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reason</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Medical appointment in the afternoon"
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {message && <p className="text-sm text-green-700">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting || !reason.trim()} className="gap-2">
                <Send className="w-4 h-4" />
                {submitting ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">My Requests</h2>
          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading...</div>
          ) : requests.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-gray-400">No early-leave requests yet</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => {
                const cfg = STATUS_CONFIG[r.status];
                return (
                  <Card key={r.id}>
                    <CardContent className="py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{format(new Date(r.date), "dd MMM yyyy")}</p>
                          <span className="text-xs text-gray-500">Leave after Period {r.leaveAfterPeriod}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{r.reason}</p>
                        {r.approvedBy && <p className="text-xs text-gray-400 mt-1">Reviewed by {r.approvedBy.name}</p>}
                      </div>
                      <Badge variant="outline" className={cn("text-xs flex items-center gap-1", cfg.color)}>
                        <cfg.icon className="w-3 h-3" />{cfg.label}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

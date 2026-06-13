"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wand2, Check, X, Clock, CalendarDays, UserCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Arrangement {
  id: string;
  date: string;
  period: number;
  subject: string | null;
  absentTeacher: { name: string; subject: string | null };
  substituteTeacher: { name: string; subject: string | null } | null;
  section: { name: string; class: { name: string } };
}

type Status = "PENDING" | "APPROVED" | "REJECTED";

interface EarlyLeave {
  id: string;
  date: string;
  leaveAfterPeriod: number;
  reason: string;
  status: Status;
  teacher: { id: string; name: string; subject: string | null };
  approvedBy: { name: string } | null;
}

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  PENDING: { label: "Pending", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  APPROVED: { label: "Approved", color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "Rejected", color: "bg-red-50 text-red-700 border-red-200" },
};

interface Props { schoolId: string }

export default function SubstitutionsClient({ schoolId }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [earlyLeaves, setEarlyLeaves] = useState<EarlyLeave[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchBoard = useCallback(async (d: string) => {
    setLoading(true);
    const [arrRes, leaveRes] = await Promise.all([
      fetch(`/api/schools/${schoolId}/arrangements?date=${d}`),
      fetch(`/api/schools/${schoolId}/early-leave`),
    ]);
    if (arrRes.ok) setArrangements(await arrRes.json());
    if (leaveRes.ok) setEarlyLeaves(await leaveRes.json());
    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    const id = window.setTimeout(() => fetchBoard(date), 0);
    return () => window.clearTimeout(id);
  }, [date, fetchBoard]);

  async function runAutoGenerate() {
    setGenerating(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/arrangements/auto-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      if (data.dayOff) {
        setMessage("That date is a non-working day (Sunday) — nothing to generate.");
      } else {
        setMessage(
          `Detected ${data.absentTeachers} absent teacher(s). Created ${data.arrangementsCreated} arrangement(s), ` +
          `assigned ${data.substitutesAssigned} substitute(s)` +
          (data.unassigned > 0 ? `, ${data.unassigned} period(s) had no free teacher.` : ".")
        );
      }
      fetchBoard(date);
      return;
    }
    setError(data.error || "Failed to auto-generate arrangements");
  }

  async function reviewEarlyLeave(id: string, status: "APPROVED" | "REJECTED") {
    setMessage("");
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/early-leave/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (res.ok) {
      if (status === "APPROVED" && data.generation) {
        setMessage(
          `Approved. Created ${data.generation.arrangementsCreated} arrangement(s), ` +
          `assigned ${data.generation.substitutesAssigned} substitute(s).`
        );
      }
      fetchBoard(date);
      return;
    }
    setError(data.error || "Failed to update request");
  }

  const periods = [...new Set(arrangements.map((a) => a.period))].sort((a, b) => a - b);
  const pendingLeaves = earlyLeaves.filter((l) => l.status === "PENDING");
  const assignedCount = arrangements.filter((a) => a.substituteTeacher).length;
  const unassignedCount = arrangements.length - assignedCount;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Substitutions</h2>
          <p className="text-sm text-gray-500 mt-1">Review the daily substitution board and approve early-leave requests</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={runAutoGenerate} disabled={generating} className="gap-2">
            <Wand2 className="w-4 h-4" />
            {generating ? "Generating..." : "Run Auto-Generate"}
          </Button>
          <Button variant="outline" onClick={() => fetchBoard(date)} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start gap-2">
          <UserCheck className="w-4 h-4 mt-0.5 flex-shrink-0" /> {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Arrangements", value: arrangements.length, color: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "Substitutes Assigned", value: assignedCount, color: "bg-green-50 border-green-200 text-green-700" },
          { label: "Unassigned", value: unassignedCount, color: "bg-orange-50 border-orange-200 text-orange-700" },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-lg border px-4 py-3", s.color)}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Early leave approval */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-600" /> Early Leave Requests
            {pendingLeaves.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold">
                {pendingLeaves.length} pending
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {earlyLeaves.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No early-leave requests</p>
          ) : (
            <div className="space-y-2">
              {earlyLeaves.map((l) => {
                const cfg = STATUS_CONFIG[l.status];
                return (
                  <div key={l.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 text-sm">{l.teacher.name}</p>
                        {l.teacher.subject && <span className="text-xs text-gray-400">{l.teacher.subject}</span>}
                        <span className="text-xs text-gray-500">
                          · {format(new Date(l.date), "dd MMM yyyy")} · leaves after P{l.leaveAfterPeriod}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{l.reason}</p>
                      {l.approvedBy && <p className="text-xs text-gray-400 mt-0.5">Reviewed by {l.approvedBy.name}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>
                      {l.status === "PENDING" && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50" title="Approve" onClick={() => reviewEarlyLeave(l.id, "APPROVED")}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" title="Reject" onClick={() => reviewEarlyLeave(l.id, "REJECTED")}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Substitution board */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-600" /> Substitution Board · {format(new Date(date + "T00:00:00"), "dd MMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading...</div>
          ) : arrangements.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No arrangements for this date. Mark teachers absent or approve leave, then run auto-generate.
            </div>
          ) : (
            <div className="space-y-5">
              {periods.map((period) => (
                <div key={period}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">P{period}</div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Period {period}</span>
                  </div>
                  <div className="space-y-2">
                    {arrangements.filter((a) => a.period === period).map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">
                            {a.section.class.name}-{a.section.name}
                            {a.subject ? <span className="text-gray-500 font-normal"> · {a.subject}</span> : null}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">In place of {a.absentTeacher.name}</p>
                        </div>
                        {a.substituteTeacher ? (
                          <span className="flex items-center gap-1.5 text-green-700 font-medium">
                            <UserCheck className="w-3.5 h-3.5" />{a.substituteTeacher.name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-orange-500 font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />Unassigned
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

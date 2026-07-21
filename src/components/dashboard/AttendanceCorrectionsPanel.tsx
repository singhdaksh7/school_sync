"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, ShieldAlert, History as HistoryIcon, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Status = "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
interface CorrectionItem { studentId: string; originalStatus: Status; requestedStatus: Status; student?: { name: string; rollNo: string } }
interface CorrectionRequest {
  id: string;
  date: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  section: { name: string; class: { name: string } };
  requestedBy: { name: string };
  items: CorrectionItem[];
}
interface ReconciliationItem { leaveRequestId: string; studentId: string; sectionId: string; date: string; currentStatus: Status }
interface HistoryEntry {
  id: string;
  date: string;
  oldStatus: Status | null;
  newStatus: Status;
  actorId: string;
  source: string;
  reason: string | null;
  student: { name: string; rollNo: string };
  createdAt: string;
}

export default function AttendanceCorrectionsPanel({ schoolId }: { schoolId: string }) {
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    const [correctionsRes, reconciliationRes] = await Promise.all([
      fetch(`/api/schools/${schoolId}/attendance/corrections?status=PENDING`),
      fetch(`/api/schools/${schoolId}/attendance/reconciliation`),
    ]);
    if (correctionsRes.ok) setCorrections((await correctionsRes.json()).data ?? []);
    if (reconciliationRes.ok) setReconciliation((await reconciliationRes.json()).items ?? []);
  }, [schoolId]);

  useEffect(() => {
    const id = window.setTimeout(fetchAll, 0);
    return () => window.clearTimeout(id);
  }, [fetchAll]);

  async function loadHistory() {
    setShowHistory((v) => !v);
    if (!showHistory) {
      const res = await fetch(`/api/schools/${schoolId}/attendance/history`);
      if (res.ok) setHistory((await res.json()).data ?? []);
    }
  }

  async function review(correctionId: string, action: "APPROVE" | "REJECT") {
    if (!window.confirm(action === "APPROVE" ? "Approve this correction request? This will update the listed students' attendance." : "Reject this correction request? No attendance will change.")) {
      return;
    }
    setReviewing(correctionId);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/attendance/corrections/${correctionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reviewNote: reviewNotes[correctionId] || undefined }),
    });
    const data = await res.json();
    setReviewing(null);
    if (!res.ok) {
      setError(data.error || "Review failed");
      return;
    }
    fetchAll();
  }

  async function applyReconciliation(item: ReconciliationItem) {
    if (!window.confirm(`Mark this student ON_LEAVE for ${item.date}, reconciling their approved leave with submitted attendance?`)) return;
    const res = await fetch(`/api/schools/${schoolId}/attendance/emergency-correction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId: item.sectionId,
        date: item.date,
        reason: "Approved leave reconciliation",
        source: "LEAVE_RECONCILIATION",
        items: [{ studentId: item.studentId, requestedStatus: "ON_LEAVE" }],
      }),
    });
    if (res.ok) fetchAll();
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {reconciliation.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" /> Leave/Attendance Reconciliation ({reconciliation.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {reconciliation.map((item) => (
              <div key={`${item.leaveRequestId}-${item.studentId}-${item.date}`} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <span>
                  Student <strong>{item.studentId}</strong> — {item.date}: approved leave, but attendance shows <strong>{item.currentStatus}</strong>
                </span>
                <Button size="sm" onClick={() => applyReconciliation(item)}>Apply ON_LEAVE</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" /> Pending Correction Requests ({corrections.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {corrections.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No pending correction requests</p>
          ) : (
            corrections.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {c.section.class.name} - {c.section.name} · {c.date.slice(0, 10)}
                    </p>
                    <p className="text-xs text-gray-500">Requested by {c.requestedBy.name}: {c.reason}</p>
                  </div>
                  <Badge variant="warning">PENDING</Badge>
                </div>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {c.items.map((i) => (
                    <li key={i.studentId}>
                      {i.student?.name ?? i.studentId}: <span className="font-medium">{i.originalStatus}</span> → <span className="font-medium text-primary">{i.requestedStatus}</span>
                    </li>
                  ))}
                </ul>
                <Textarea
                  rows={1}
                  placeholder="Optional review note"
                  value={reviewNotes[c.id] || ""}
                  onChange={(e) => setReviewNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => review(c.id, "REJECT")} disabled={reviewing === c.id}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                  <Button size="sm" className="gap-1" onClick={() => review(c.id, "APPROVE")} disabled={reviewing === c.id}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><HistoryIcon className="h-4 w-4" /> Attendance History</span>
            <Button variant="outline" size="sm" onClick={loadHistory}>{showHistory ? "Hide" : "View"}</Button>
          </CardTitle>
        </CardHeader>
        {showHistory && (
          <CardContent className="pt-0 space-y-1 max-h-96 overflow-y-auto">
            {history.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No history yet</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-xs text-gray-600 last:border-0">
                  <span>{h.student.name} · {h.date.slice(0, 10)} · {h.oldStatus ?? "—"} → {h.newStatus}</span>
                  <span className="text-gray-400">{h.source}</span>
                </div>
              ))
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

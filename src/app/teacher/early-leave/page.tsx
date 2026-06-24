"use client";

import { useCallback, useEffect, useState } from "react";
import { DoorOpen, Send, Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

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

const STATUS_CONFIG: Record<Status, { labelKey: string; icon: typeof Check; color: string }> = {
  PENDING: { labelKey: "teacherEarlyLeave.statusPending", icon: Clock, color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  APPROVED: { labelKey: "teacherEarlyLeave.statusApproved", icon: Check, color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { labelKey: "teacherEarlyLeave.statusRejected", icon: X, color: "bg-red-50 text-red-700 border-red-200" },
};

export default function TeacherEarlyLeavePage() {
  const { t } = useTranslation();
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
      setMessage(t("teacherEarlyLeave.submittedMessage"));
      setReason("");
      fetchRequests();
      return;
    }
    setError(data.error || t("teacherEarlyLeave.unableToSubmit"));
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DoorOpen className="w-6 h-6 text-blue-600" /> {t("teacherEarlyLeave.title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("teacherEarlyLeave.subtitle")}
          </p>
        </div>

        {/* Request form */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">{t("teacherEarlyLeave.newRequest")}</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t("common.date")}</p>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t("teacherEarlyLeave.leaveAfterPeriod")}</p>
                <select
                  value={leaveAfterPeriod}
                  onChange={(e) => setLeaveAfterPeriod(Number(e.target.value))}
                  className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>{t("teacherEarlyLeave.afterPeriod", { period: p })}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t("common.reason")}</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={t("teacherEarlyLeave.reasonPlaceholder")}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {message && <p className="text-sm text-green-700">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting || !reason.trim()} className="gap-2">
                <Send className="w-4 h-4" />
                {submitting ? t("common.submitting") : t("common.submitRequest")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t("teacherEarlyLeave.myRequests")}</h2>
          {loading ? (
            <div className="text-center py-12 text-gray-400">{t("common.loading")}</div>
          ) : requests.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-gray-400">{t("teacherEarlyLeave.noRequestsYet")}</CardContent></Card>
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
                          <span className="text-xs text-gray-500">{t("teacherEarlyLeave.leaveAfterPeriodBadge", { period: r.leaveAfterPeriod })}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{r.reason}</p>
                        {r.approvedBy && <p className="text-xs text-gray-400 mt-1">{t("teacherEarlyLeave.reviewedBy", { name: r.approvedBy.name })}</p>}
                      </div>
                      <Badge variant="outline" className={cn("text-xs flex items-center gap-1", cfg.color)}>
                        <cfg.icon className="w-3 h-3" />{t(cfg.labelKey)}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";

type Impact = {
  school: { id: string; name: string; slug: string; status: string };
  counts: Record<string, number>;
};

const LIFECYCLE_LABEL: Record<string, string> = {
  PENDING_DELETION: "Pending deletion",
  DELETING: "Deleting…",
  DELETION_FAILED: "Deletion failed (retryable)",
  DELETED: "Deleted",
};

export default function SchoolDangerZone({ schoolId, schoolName, schoolSlug, status, deletionScheduledFor }: {
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  status: string;
  deletionScheduledFor: string | null;
}) {
  const router = useRouter();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactError, setImpactError] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPassword, setCancelPassword] = useState("");

  const isPendingDeletion = status === "PENDING_DELETION";
  const isTerminalOrDeleting = status === "DELETING" || status === "DELETED";

  useEffect(() => {
    fetch(`/api/founder/schools/${schoolId}/deletion`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: Impact) => setImpact(json))
      .catch(() => setImpactError(true));
  }, [schoolId]);

  function openSchedule() {
    setStep(1);
    setConfirmText("");
    setPassword("");
    setFormError(null);
    setScheduleOpen(true);
  }

  async function submitSchedule() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/founder/schools/${schoolId}/deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmedNameOrSlug: confirmText }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setScheduleOpen(false);
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/founder/schools/${schoolId}/deletion`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: cancelPassword }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setCancelOpen(false);
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="h-4 w-4" /> Danger Zone
        </CardTitle>
        <CardDescription>Archive or permanently delete this school&apos;s data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status !== "ACTIVE" && status !== "TRIAL" && status !== "SUSPENDED" && status !== "EXPIRED" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            <p className="font-medium">{LIFECYCLE_LABEL[status] ?? status}</p>
            {deletionScheduledFor && isPendingDeletion && (
              <p className="mt-1">Scheduled purge date: {formatDate(deletionScheduledFor)}. Restorable until then.</p>
            )}
          </div>
        )}

        {impactError && <p className="text-sm text-muted-foreground">Couldn&apos;t load impact counts.</p>}
        {impact && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            {Object.entries(impact.counts).map(([key, value]) => (
              <div key={key} className="rounded-md border border-border px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{key}</p>
                <p className="font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {isPendingDeletion && (
            <Button variant="outline" onClick={() => { setFormError(null); setCancelPassword(""); setCancelOpen(true); }} className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> Cancel deletion / Restore
            </Button>
          )}
          {!isPendingDeletion && !isTerminalOrDeleting && (
            <Button variant="destructive" onClick={openSchedule} className="gap-1.5">
              <Trash2 className="h-4 w-4" /> Schedule permanent deletion
            </Button>
          )}
        </div>
      </CardContent>

      {/* Schedule deletion: impact -> re-auth + typed confirmation (two explicit steps) */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule permanent deletion</DialogTitle>
            <DialogDescription>
              {step === 1
                ? "This schedules a purge of all tenant data after the retention window. The school is blocked from normal use immediately."
                : "Confirm your identity and type the school name or slug exactly."}
            </DialogDescription>
          </DialogHeader>

          {step === 1 ? (
            <div className="space-y-3 text-sm">
              <p>Backups expire per the platform&apos;s backup-retention policy and generally cannot be selectively rewritten to remove just this school.</p>
              {impact && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {Object.entries(impact.counts).map(([key, value]) => (
                    <li key={key}>{value} {key}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Your password (re-authentication)</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Type &quot;{schoolName}&quot; or &quot;{schoolSlug}&quot; to confirm</Label>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={busy}>Cancel</Button>
            {step === 1 ? (
              <Button variant="destructive" onClick={() => setStep(2)}>Continue</Button>
            ) : (
              <Button variant="destructive" onClick={submitSchedule} disabled={busy || !password || !confirmText}>
                {busy ? "Scheduling..." : "Confirm deletion"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel / restore */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel deletion &amp; restore</DialogTitle>
            <DialogDescription>Confirm your password to restore this school to normal access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Your password (re-authentication)</Label>
            <Input type="password" value={cancelPassword} onChange={(e) => setCancelPassword(e.target.value)} />
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy}>Close</Button>
            <Button onClick={submitCancel} disabled={busy || !cancelPassword}>{busy ? "Restoring..." : "Restore school"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SCHOOL_STATUSES, SCHOOL_STATUS_LABEL, SCHOOL_STATUS_BADGE_VARIANT, type SchoolStatusValue } from "@/lib/school-status";

export default function SchoolStatusControl({ schoolId, status }: { schoolId: string; status: SchoolStatusValue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<SchoolStatusValue>(status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startChange(value: SchoolStatusValue) {
    setPendingStatus(value);
    setError(null);
    setOpen(true);
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/founder/schools/${schoolId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: pendingStatus }),
      });
      if (!res.ok) throw new Error("Request failed");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't update status. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant={SCHOOL_STATUS_BADGE_VARIANT[status]}>{SCHOOL_STATUS_LABEL[status]}</Badge>
        <Select value={status} onValueChange={(v) => startChange(v as SchoolStatusValue)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Change status" />
          </SelectTrigger>
          <SelectContent>
            {SCHOOL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{SCHOOL_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change school status?</DialogTitle>
            <DialogDescription>
              This will set the status to <strong>{SCHOOL_STATUS_LABEL[pendingStatus]}</strong>. This is a manual override and does not affect billing automatically.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={confirm} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

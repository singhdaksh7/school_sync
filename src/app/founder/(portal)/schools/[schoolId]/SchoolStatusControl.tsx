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
import { useTranslation } from "@/lib/i18n/LanguageContext";

export default function SchoolStatusControl({ schoolId, status }: { schoolId: string; status: SchoolStatusValue }) {
  const { t } = useTranslation();
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
      if (!res.ok) throw new Error(t("founder.requestFailed"));
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("founder.couldntUpdateStatus"));
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
            <SelectValue placeholder={t("founder.changeStatus")} />
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
            <DialogTitle>{t("founder.changeSchoolStatusQuestion")}</DialogTitle>
            <DialogDescription>
              {t("founder.changeStatusNotePrefix")} <strong>{SCHOOL_STATUS_LABEL[pendingStatus]}</strong>. {t("founder.changeStatusNoteSuffix")}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={confirm} disabled={saving}>{saving ? t("common.saving") : t("founder.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

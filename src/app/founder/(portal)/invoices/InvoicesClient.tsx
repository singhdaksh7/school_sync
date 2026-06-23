"use client";

import { useEffect, useState } from "react";
import { Search, FileText, ChevronLeft, ChevronRight, AlertTriangle, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatDate, formatCurrency } from "@/lib/utils";
import { INVOICE_STATUSES, INVOICE_STATUS_LABEL, INVOICE_STATUS_BADGE_VARIANT, type InvoiceStatusValue } from "@/lib/billing-status";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Row = {
  id: string;
  invoiceNumber: string;
  amount: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  status: InvoiceStatusValue;
  notes: string | null;
  school: { id: string; name: string };
  plan: { id: string; name: string } | null;
};

type ListResponse = { invoices: Row[]; total: number; page: number; totalPages: number };
type SchoolOption = { id: string; name: string };
type PlanOption = { id: string; name: string };

export default function InvoicesClient() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("ALL");
  const [school, setSchool] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [status, school]);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) {
        setLoading(true);
        setError(false);
      }
    }, 0);

    const params = new URLSearchParams({ page: String(page) });
    if (status !== "ALL") params.set("status", status);
    if (school) params.set("school", school);

    fetch(`/api/founder/invoices?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Request failed"))))
      .then((json: ListResponse) => {
        if (active) setData(json);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [status, school, page, refreshKey]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("nav.invoices")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("founder.invoicesDescription")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("founder.createInvoice")}
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{t("nav.invoices")}{data ? ` (${data.total})` : ""}</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder={t("founder.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("founder.allStatuses")}</SelectItem>
                {INVOICE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={school} onChange={(e) => setSchool(e.target.value)} placeholder={t("founder.filterBySchool")} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 py-14 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm font-medium text-foreground">{t("founder.couldntLoadInvoices")}</p>
            </div>
          ) : !data || data.invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("founder.noInvoicesFound")}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">{t("founder.invoiceNumber")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("nav.schools")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("founder.amount")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("founder.dueDate")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("founder.status")}</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelected(row)}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-3 pr-4 font-medium text-foreground">{row.invoiceNumber}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{row.school.name}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(row.amount)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatDate(row.dueDate)}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={INVOICE_STATUS_BADGE_VARIANT[row.status]}>{INVOICE_STATUS_LABEL[row.status]}</Badge>
                        </td>
                        <td className="py-3 text-right text-muted-foreground">
                          <ChevronRight className="ml-auto h-4 w-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{t("founder.pageOf", { page: data.page, totalPages: data.totalPages })}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />

      <InvoiceDetailDialog
        invoice={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onUpdated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function SchoolPicker({ value, onSelect }: { value: SchoolOption | null; onSelect: (s: SchoolOption) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolOption[]>([]);

  useEffect(() => {
    if (!query) {
      const clearId = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(clearId);
    }
    const id = setTimeout(() => {
      fetch(`/api/founder/schools?q=${encodeURIComponent(query)}&page=1`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { schools: SchoolOption[] } | null) => setResults(json?.schools ?? []));
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
        <span className="font-medium text-foreground">{value.name}</span>
        <button type="button" onClick={() => onSelect({ id: "", name: "" })} className="text-xs text-muted-foreground hover:text-foreground">
          {t("founder.change")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("founder.searchSchools")} />
      {results.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s);
                setQuery("");
                setResults([]);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateInvoiceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [schoolSel, setSchoolSel] = useState<SchoolOption | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [billingPeriodStart, setBillingPeriodStart] = useState("");
  const [billingPeriodEnd, setBillingPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSchoolSel(null);
    setPlanId("");
    setInvoiceNumber(`INV-${Date.now().toString().slice(-8)}`);
    setAmount("");
    setBillingPeriodStart("");
    setBillingPeriodEnd("");
    setDueDate("");
    setNotes("");
    setError(null);
    fetch("/api/founder/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { plans: PlanOption[] } | null) => json && setPlans(json.plans));
  }, [open]);

  async function save() {
    if (!schoolSel?.id) {
      setError(t("founder.selectASchool"));
      return;
    }
    if (!invoiceNumber.trim()) {
      setError(t("founder.invoiceNumberRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/founder/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          schoolId: schoolSel.id,
          planId: planId || null,
          amount: Number(amount) || 0,
          billingPeriodStart,
          billingPeriodEnd,
          dueDate,
          notes,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t("founder.requestFailed"));
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("founder.createInvoice")}</DialogTitle>
          <DialogDescription>{t("founder.createInvoiceDescription")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>{t("nav.schools")}</Label>
            <SchoolPicker value={schoolSel} onSelect={setSchoolSel} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("founder.invoiceNumber")}</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("founder.planOptional")}</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder={t("founder.noPlan")} /></SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("founder.amountInRupees")}</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("founder.billingPeriodStart")}</Label>
              <Input type="date" value={billingPeriodStart} onChange={(e) => setBillingPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("founder.billingPeriodEnd")}</Label>
              <Input type="date" value={billingPeriodEnd} onChange={(e) => setBillingPeriodEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("founder.dueDate")}</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("founder.notesOptional")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t("founder.creating") : t("founder.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetailDialog({
  invoice,
  onOpenChange,
  onUpdated,
}: {
  invoice: Row | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [pendingStatus, setPendingStatus] = useState<InvoiceStatusValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invoice) return null;

  async function applyStatus(newStatus: InvoiceStatusValue) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/founder/invoices/${invoice!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(t("founder.requestFailed"));
      setPendingStatus(null);
      onOpenChange(false);
      onUpdated();
    } catch {
      setError(t("founder.couldntUpdateStatus"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invoice.invoiceNumber}</DialogTitle>
          <DialogDescription>{invoice.school.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label={t("founder.amount")} value={formatCurrency(invoice.amount)} />
            <Field label={t("founder.plan")} value={invoice.plan?.name ?? "—"} />
            <Field label={t("founder.billingPeriod")} value={`${formatDate(invoice.billingPeriodStart)} – ${formatDate(invoice.billingPeriodEnd)}`} />
            <Field label={t("founder.dueDate")} value={formatDate(invoice.dueDate)} />
          </div>
          {invoice.notes && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("founder.notes")}</p>
              <p className="mt-1 text-sm text-foreground">{invoice.notes}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("founder.status")}</Label>
            <Select value={invoice.status} onValueChange={(v) => setPendingStatus(v as InvoiceStatusValue)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVOICE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {pendingStatus && pendingStatus !== invoice.status && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatus(null)} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={() => applyStatus(pendingStatus)} disabled={saving}>
              {saving ? t("common.saving") : t("founder.setToStatus", { status: INVOICE_STATUS_LABEL[pendingStatus] })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CreditCard, Receipt, FileText, Plus, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatDate, formatCurrency } from "@/lib/utils";
import { SCHOOL_STATUS_LABEL, SCHOOL_STATUS_BADGE_VARIANT, type SchoolStatusValue } from "@/lib/school-status";
import { PAYMENT_PROOF_STATUS_LABEL, PAYMENT_PROOF_STATUS_BADGE_VARIANT, INVOICE_STATUS_LABEL, INVOICE_STATUS_BADGE_VARIANT, type PaymentProofStatusValue, type InvoiceStatusValue } from "@/lib/billing-status";

const MAX_FILE_BYTES = 2_000_000;

type SubscriptionSummary = {
  planName: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  amount: string;
  currentPeriodEnd: string | null;
} | null;

type Submission = {
  id: string;
  billingMonth: string;
  paymentDate: string;
  amount: string;
  transactionRef: string | null;
  notes: string | null;
  status: PaymentProofStatusValue;
  reviewNotes: string | null;
  createdAt: string;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  status: InvoiceStatusValue;
  plan: { name: string } | null;
};

export default function BillingClient({
  schoolId,
  status,
  subscription,
}: {
  schoolId: string;
  status: SchoolStatusValue;
  subscription: SubscriptionSummary;
}) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) setLoading(true);
    }, 0);
    Promise.all([
      fetch(`/api/schools/${schoolId}/payment-proofs`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/schools/${schoolId}/invoices`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([proofs, invs]) => {
      if (!active) return;
      setSubmissions(proofs?.submissions ?? []);
      setInvoices(invs?.invoices ?? []);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [schoolId, refreshKey]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Billing</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your subscription, payment proofs, and invoices.</p>
        </div>
        <Button onClick={() => setSubmitOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Submit Payment Proof
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-primary" /> Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Plan" value={subscription.planName} />
              <Field label="Status">
                <Badge variant={SCHOOL_STATUS_BADGE_VARIANT[status]}>{SCHOOL_STATUS_LABEL[status]}</Badge>
              </Field>
              <Field label="Billing Cycle" value={subscription.billingCycle === "ANNUAL" ? "Annual" : "Monthly"} />
              <Field label="Amount" value={formatCurrency(subscription.amount)} />
              <Field label="Renewal Date" value={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"} />
            </div>
          ) : (
            <EmptyState message="No subscription assigned yet. Contact the platform team." />
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-primary" /> Payment Proof Submissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonRows />
          ) : !submissions || submissions.length === 0 ? (
            <EmptyState message="No payment proofs submitted yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Billing Month</th>
                    <th className="pb-2 pr-4 font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Submitted</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr key={s.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{formatDate(s.billingMonth)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{formatCurrency(s.amount)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{formatDate(s.createdAt)}</td>
                      <td className="py-2.5">
                        <Badge variant={PAYMENT_PROOF_STATUS_BADGE_VARIANT[s.status]}>{PAYMENT_PROOF_STATUS_LABEL[s.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" /> Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonRows />
          ) : !invoices || invoices.length === 0 ? (
            <EmptyState message="No invoices yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Invoice #</th>
                    <th className="pb-2 pr-4 font-medium">Plan</th>
                    <th className="pb-2 pr-4 font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Due Date</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{inv.invoiceNumber}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{inv.plan?.name ?? "—"}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{formatCurrency(inv.amount)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{formatDate(inv.dueDate)}</td>
                      <td className="py-2.5">
                        <Badge variant={INVOICE_STATUS_BADGE_VARIANT[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SubmitProofDialog
        schoolId={schoolId}
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmitted={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function SubmitProofDialog({
  schoolId,
  open,
  onOpenChange,
  onSubmitted,
}: {
  schoolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [billingMonth, setBillingMonth] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBillingMonth("");
    setPaymentDate("");
    setAmount("");
    setTransactionRef("");
    setNotes("");
    setFile(null);
    setError(null);
  }, [open]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_FILE_BYTES) {
      setError("File is too large (max ~2MB)");
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
  }

  function readFileAsDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
  }

  async function submit() {
    if (!billingMonth || !paymentDate || !amount || !file) {
      setError("Billing month, payment date, amount, and receipt are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const receiptData = await readFileAsDataUrl(file);
      const res = await fetch(`/api/schools/${schoolId}/payment-proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingMonth: `${billingMonth}-01`,
          paymentDate,
          amount: Number(amount),
          transactionRef,
          notes,
          receiptData,
          receiptFileName: file.name,
          receiptMimeType: file.type,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Request failed");
      onOpenChange(false);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit Payment Proof</DialogTitle>
          <DialogDescription>Upload proof of an offline payment for the Founder team to review.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Billing Month</Label>
            <Input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Amount (₹)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Transaction Reference (optional)</Label>
            <Input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Receipt (screenshot or PDF, max ~2MB)</Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input px-4 py-6 text-sm text-muted-foreground hover:bg-muted/50">
              <Upload className="h-4 w-4" />
              {file ? file.name : "Choose a file"}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Submitting..." : "Submit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-lg font-bold text-foreground">{children ?? value}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Search, Receipt, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatDate, formatCurrency } from "@/lib/utils";
import { PAYMENT_PROOF_STATUSES, PAYMENT_PROOF_STATUS_LABEL, PAYMENT_PROOF_STATUS_BADGE_VARIANT, type PaymentProofStatusValue } from "@/lib/billing-status";

type Row = {
  id: string;
  billingMonth: string;
  paymentDate: string;
  amount: string;
  transactionRef: string | null;
  status: PaymentProofStatusValue;
  createdAt: string;
  school: { id: string; name: string };
  submittedBy: { id: string; name: string };
};

type Detail = Row & {
  notes: string | null;
  reviewNotes: string | null;
  receiptData: string;
  receiptFileName: string | null;
  receiptMimeType: string | null;
};

type ListResponse = { submissions: Row[]; total: number; page: number; totalPages: number };

export default function PaymentProofsClient() {
  const [status, setStatus] = useState("ALL");
  const [school, setSchool] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [status, school]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);

    const params = new URLSearchParams({ page: String(page) });
    if (status !== "ALL") params.set("status", status);
    if (school) params.set("school", school);

    fetch(`/api/founder/payment-proofs?${params.toString()}`, { cache: "no-store" })
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
    };
  }, [status, school, page, refreshKey]);

  function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setReviewNotes("");
    setActionError(null);
    fetch(`/api/founder/payment-proofs/${id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Request failed"))))
      .then((json: { submission: Detail }) => setDetail(json.submission))
      .catch(() => setActionError("Couldn't load this submission."))
      .finally(() => setDetailLoading(false));
  }

  async function applyReview(newStatus: "APPROVED" | "REJECTED") {
    if (!selectedId) return;
    setActionPending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/founder/payment-proofs/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, reviewNotes: reviewNotes || undefined }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSelectedId(null);
      setConfirmAction(null);
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("Couldn't save your decision. Please try again.");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Payment Proofs</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review manually submitted payment proofs from schools.</p>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Submissions{data ? ` (${data.total})` : ""}</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {PAYMENT_PROOF_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{PAYMENT_PROOF_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Filter by school..." className="pl-9" />
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
              <p className="text-sm font-medium text-foreground">Couldn&apos;t load submissions</p>
            </div>
          ) : !data || data.submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No submissions found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">School</th>
                      <th className="pb-2 pr-4 font-medium">Billing Month</th>
                      <th className="pb-2 pr-4 font-medium">Amount</th>
                      <th className="pb-2 pr-4 font-medium">Submitted</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.submissions.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => openDetail(row.id)}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-3 pr-4 font-medium text-foreground">{row.school.name}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatDate(row.billingMonth)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(row.amount)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatDate(row.createdAt)}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={PAYMENT_PROOF_STATUS_BADGE_VARIANT[row.status]}>{PAYMENT_PROOF_STATUS_LABEL[row.status]}</Badge>
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
                <p className="text-xs text-muted-foreground">Page {data.page} of {data.totalPages}</p>
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

      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment Proof Details</DialogTitle>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="h-40 w-full animate-pulse rounded-md bg-muted" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <Field label="School" value={detail.school.name} />
                <Field label="Submitted By" value={detail.submittedBy.name} />
                <Field label="Status">
                  <Badge variant={PAYMENT_PROOF_STATUS_BADGE_VARIANT[detail.status]}>{PAYMENT_PROOF_STATUS_LABEL[detail.status]}</Badge>
                </Field>
                <Field label="Billing Month" value={formatDate(detail.billingMonth)} />
                <Field label="Payment Date" value={formatDate(detail.paymentDate)} />
                <Field label="Amount" value={formatCurrency(detail.amount)} />
                <Field label="Transaction Ref" value={detail.transactionRef || "—"} />
              </div>
              {detail.notes && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">School Notes</p>
                  <p className="mt-1 text-sm text-foreground">{detail.notes}</p>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Receipt</p>
                <ReceiptPreview detail={detail} />
              </div>

              {detail.status !== "PENDING" && detail.reviewNotes && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review Notes</p>
                  <p className="mt-1 text-sm text-foreground">{detail.reviewNotes}</p>
                </div>
              )}

              {detail.status === "PENDING" && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review Notes (optional)</p>
                  <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Internal note for this decision..." />
                </div>
              )}

              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            </div>
          )}

          {detail?.status === "PENDING" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmAction("REJECTED")} disabled={actionPending} className="text-destructive">
                Reject
              </Button>
              <Button onClick={() => setConfirmAction("APPROVED")} disabled={actionPending}>
                Approve
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction === "APPROVED" ? "Approve this submission?" : "Reject this submission?"}</DialogTitle>
            <DialogDescription>
              This does not automatically change the school&apos;s subscription status or renewal date — update those separately if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={actionPending}>Cancel</Button>
            <Button onClick={() => confirmAction && applyReview(confirmAction)} disabled={actionPending}>
              {actionPending ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-medium text-foreground">{children ?? value}</div>
    </div>
  );
}

function ReceiptPreview({ detail }: { detail: Detail }) {
  const isImage = detail.receiptMimeType?.startsWith("image/");
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={detail.receiptData} alt="Payment receipt" className="max-h-80 rounded-lg border border-border object-contain" />
    );
  }
  return (
    <a
      href={detail.receiptData}
      download={detail.receiptFileName ?? "receipt.pdf"}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
    >
      <Receipt className="h-4 w-4" /> {detail.receiptFileName ?? "Download receipt"}
    </a>
  );
}

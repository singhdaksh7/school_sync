"use client";

import { useMemo, useState } from "react";
import { IndianRupee, Plus, Trash2, Receipt, TrendingUp, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  buildStudentFeeAccounts,
  MANUAL_FEE_PAYMENT_METHODS,
  type ManualFeePaymentMethod,
} from "@/lib/student-fee-ledger";

interface FeeStructure {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  classId: string | null;
  class: { id: string; name: string } | null;
}

interface Student {
  id: string;
  name: string;
  rollNo: string;
  section: { name: string; class: { id: string; name: string } };
}

interface FeePayment {
  id: string;
  amount: number;
  paidAt: string | null;
  method: string | null;
  referenceNumber: string | null;
  notes: string | null;
  receiptNumber: string | null;
  status: string;
  studentId: string;
  feeStructureId: string;
  createdAt: string;
  paymentGateway: string | null;
  gatewayPaymentId: string | null;
  student: { name: string; rollNo: string; section: { name: string; class: { name: string } } };
  feeStructure: { name: string; amount: number };
  recordedBy: { name: string } | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  ANNUAL: "Annual",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ONE_TIME: "One-time",
};

const FREQUENCY_COLORS: Record<string, string> = {
  ANNUAL: "bg-blue-50 text-blue-700 border-blue-200",
  MONTHLY: "bg-green-50 text-green-700 border-green-200",
  QUARTERLY: "bg-purple-50 text-purple-700 border-purple-200",
  ONE_TIME: "bg-orange-50 text-orange-700 border-orange-200",
};

const METHOD_COLORS: Record<string, string> = {
  CASH: "bg-yellow-50 text-yellow-700",
  UPI: "bg-green-50 text-green-700",
  BANK_TRANSFER: "bg-blue-50 text-blue-700",
  CHEQUE: "bg-purple-50 text-purple-700",
  OTHER: "bg-gray-100 text-gray-700",
  ONLINE: "bg-blue-50 text-blue-700",
};

const STATUS_COLORS: Record<string, string> = {
  PAID: "bg-green-50 text-green-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  UNPAID: "bg-red-50 text-red-700",
  PENDING: "bg-amber-50 text-amber-700",
  FAILED: "bg-red-50 text-red-700",
};

const METHOD_LABELS: Record<ManualFeePaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

type Tab = "structures" | "accounts" | "payments";

interface Props {
  initialStructures: FeeStructure[];
  initialPayments: FeePayment[];
  initialStudents: Student[];
  initialClasses: { id: string; name: string }[];
  schoolId: string;
}

export default function FeesClient({ initialStructures, initialPayments, initialStudents, initialClasses, schoolId }: Props) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [structures, setStructures] = useState<FeeStructure[]>(initialStructures);
  const [payments, setPayments] = useState<FeePayment[]>(initialPayments);
  const [students] = useState<Student[]>(initialStudents);
  const [classes] = useState(initialClasses);
  const [loading, setLoading] = useState(false);

  const [structureDialog, setStructureDialog] = useState(false);
  const [structureForm, setStructureForm] = useState({ name: "", amount: "", frequency: "ANNUAL", classId: "" });
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureError, setStructureError] = useState("");

  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    studentId: "",
    feeStructureId: "",
    amount: "",
    method: "CASH" as ManualFeePaymentMethod,
    paidAt: "",
    referenceNumber: "",
    remarks: "",
  });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [receiptDialog, setReceiptDialog] = useState(false);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<FeePayment | null>(null);

  function handleViewReceipt(payment: FeePayment) {
    setSelectedReceiptPayment(payment);
    setReceiptDialog(true);
  }

  const feeAccounts = useMemo(
    () =>
      buildStudentFeeAccounts({
        students,
        feeStructures: structures,
        payments,
      }),
    [students, structures, payments]
  );

  async function fetchAll() {
    setLoading(true);
    const [structRes, payRes] = await Promise.all([
      fetch(`/api/schools/${schoolId}/fee-structures`, { cache: "no-store" }),
      fetch(`/api/schools/${schoolId}/fee-payments?limit=100`, { cache: "no-store" }),
    ]);
    const structuresJson = await structRes.json();
    const paymentsJson = await payRes.json();
    const paymentsList = Array.isArray(paymentsJson) ? paymentsJson : paymentsJson.data;
    setStructures(Array.isArray(structuresJson) ? structuresJson : []);
    setPayments(Array.isArray(paymentsList) ? paymentsList : []);
    setLoading(false);
  }

  async function saveStructure() {
    if (!structureForm.name.trim() || !structureForm.amount) {
      setStructureError("Name and amount are required");
      return;
    }
    setStructureSaving(true);
    setStructureError("");
    const res = await fetch(`/api/schools/${schoolId}/fee-structures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: structureForm.name,
        amount: parseFloat(structureForm.amount),
        frequency: structureForm.frequency,
        classId: structureForm.classId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStructureError(data.error || "Failed to create fee structure");
      setStructureSaving(false);
      return;
    }
    setStructureDialog(false);
    setStructureForm({ name: "", amount: "", frequency: "ANNUAL", classId: "" });
    await fetchAll();
    setStructureSaving(false);
  }

  async function deleteStructure(id: string) {
    if (!confirm("Delete this fee structure? All payment records linked to it will also be deleted.")) return;
    await fetch(`/api/schools/${schoolId}/fee-structures/${id}`, { method: "DELETE" });
    await fetchAll();
  }

  async function savePayment() {
    if (!paymentForm.studentId || !paymentForm.feeStructureId || !paymentForm.amount) {
      setPaymentError("Student, fee type, and amount received are required");
      return;
    }
    setPaymentSaving(true);
    setPaymentError("");
    const res = await fetch(`/api/schools/${schoolId}/fee-payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: paymentForm.studentId,
        feeStructureId: paymentForm.feeStructureId,
        amount: parseFloat(paymentForm.amount),
        method: paymentForm.method,
        paidAt: paymentForm.paidAt || undefined,
        referenceNumber: paymentForm.referenceNumber || undefined,
        remarks: paymentForm.remarks || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPaymentError(data.error || "Failed to record payment");
      setPaymentSaving(false);
      return;
    }
    setPaymentDialog(false);
    setPaymentForm({
      studentId: "",
      feeStructureId: "",
      amount: "",
      method: "CASH",
      paidAt: "",
      referenceNumber: "",
      remarks: "",
    });
    await fetchAll();
    setPaymentSaving(false);
  }

  function onFeeStructureChange(id: string) {
    const structure = structures.find((s) => s.id === id);
    setPaymentForm((prev) => ({
      ...prev,
      feeStructureId: id,
      amount: structure ? String(structure.amount) : prev.amount,
    }));
  }

  const paidPayments = payments.filter((p) => p.status === "PAID");
  const totalCollected = paidPayments.reduce((sum, p) => sum + p.amount, 0);
  const thisMonth = paidPayments.filter((p) => {
    if (!p.paidAt) return false;
    const d = new Date(p.paidAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonthTotal = thisMonth.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Fee Management</h2>
          <p className="mt-1 text-sm text-gray-500">Manual ledger of externally received student fees</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setStructureError("");
              setStructureForm({ name: "", amount: "", frequency: "ANNUAL", classId: "" });
              setStructureDialog(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Fee Structure
          </Button>
          <Button
            onClick={() => {
              setPaymentError("");
              setPaymentForm({
                studentId: "",
                feeStructureId: "",
                amount: "",
                method: "CASH",
                paidAt: "",
                referenceNumber: "",
                remarks: "",
              });
              setPaymentDialog(true);
            }}
            className="gap-2"
            disabled={structures.length === 0 || students.length === 0}
          >
            <Receipt className="h-4 w-4" /> Record Payment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Collected", value: `₹${totalCollected.toLocaleString("en-IN")}`, icon: TrendingUp, color: "bg-green-100 text-green-600" },
          { label: "This Month", value: `₹${thisMonthTotal.toLocaleString("en-IN")}`, icon: IndianRupee, color: "bg-blue-100 text-blue-600" },
          { label: "Fee Accounts", value: feeAccounts.length, icon: CheckCircle, color: "bg-purple-100 text-purple-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pb-4 pt-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-xl font-bold text-gray-900">{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex border-b border-gray-200">
        {(["accounts", "payments", "structures"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t === "accounts"
              ? `Fee Accounts (${feeAccounts.length})`
              : t === "payments"
                ? `Payments (${payments.length})`
                : `Fee Structures (${structures.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : tab === "structures" ? (
        structures.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <IndianRupee className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-500">No fee structures yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {structures.map((s) => (
              <Card key={s.id} className="transition-shadow hover:shadow-md">
                <CardContent className="pb-4 pt-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">{s.name}</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900">₹{s.amount.toLocaleString("en-IN")}</p>
                      <div className="mt-2 flex gap-2">
                        <Badge variant="outline" className={cn("text-xs", FREQUENCY_COLORS[s.frequency])}>
                          {FREQUENCY_LABELS[s.frequency]}
                        </Badge>
                        {s.class && (
                          <Badge variant="outline" className="text-xs">
                            {s.class.name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-400 hover:text-red-600"
                      onClick={() => deleteStructure(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : tab === "accounts" ? (
        feeAccounts.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <Receipt className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-500">No student fee accounts to show</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Student Fee Accounts</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {feeAccounts.map((account) => (
                  <div key={account.key} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {account.student.name} · {account.student.section.class.name}-{account.student.section.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          Roll {account.student.rollNo} · {account.feeStructure.name}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded px-2 py-1 text-xs font-medium",
                          STATUS_COLORS[account.status] || "bg-gray-50 text-gray-600"
                        )}
                      >
                        {account.status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div className="rounded bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">Total Fee</p>
                        <p className="text-sm font-semibold text-gray-900">₹{account.totalFee.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="rounded bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">Paid Till Date</p>
                        <p className="text-sm font-semibold text-green-700">₹{account.paidTillDate.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="rounded bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">Remaining</p>
                        <p className="text-sm font-semibold text-amber-700">₹{account.remainingAmount.toLocaleString("en-IN")}</p>
                      </div>
                    </div>

                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-gray-500">Payment History</p>
                      {account.payments.length === 0 ? (
                        <p className="text-xs text-gray-400">No payments recorded yet</p>
                      ) : (
                        <div className="space-y-1.5">
                          {account.payments.map((payment) => (
                            <div key={payment.id} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 text-xs">
                              <div>
                                <p className="font-medium text-gray-800">
                                  ₹{payment.amount.toLocaleString("en-IN")} · {payment.method || "Manual"}
                                </p>
                                <p className="text-gray-500">
                                  {payment.paidAt ? format(new Date(payment.paidAt), "dd MMM yyyy") : "No payment date"}
                                  {payment.referenceNumber ? ` · Ref: ${payment.referenceNumber}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[10px] text-blue-600 hover:text-blue-800 px-2 font-semibold"
                                  onClick={() => handleViewReceipt({
                                    id: payment.id,
                                    amount: payment.amount,
                                    paidAt: payment.paidAt ? String(payment.paidAt) : null,
                                    method: payment.method,
                                    referenceNumber: payment.referenceNumber,
                                    notes: null,
                                    receiptNumber: payment.receiptNumber || null,
                                    status: payment.status,
                                    studentId: account.studentId,
                                    feeStructureId: account.feeStructureId,
                                    createdAt: payment.createdAt ? String(payment.createdAt) : "",
                                    paymentGateway: null,
                                    gatewayPaymentId: null,
                                    student: {
                                      name: account.student.name,
                                      rollNo: account.student.rollNo ?? "—",
                                      section: {
                                        name: account.student.section.name,
                                        class: {
                                          name: account.student.section.class.name,
                                        }
                                      }
                                    },
                                    feeStructure: {
                                      name: account.feeStructure.name,
                                      amount: account.feeStructure.amount,
                                    },
                                    recordedBy: null,
                                  })}
                                >
                                  Receipt
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      ) : payments.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Receipt className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="font-medium text-gray-500">No payments recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment Records</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                      {p.student.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{p.student.name}</p>
                      <p className="text-xs text-gray-400">
                        {p.student.section.class.name} - {p.student.section.name} · Roll {p.student.rollNo}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">{p.feeStructure.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_COLORS[p.status] || "bg-gray-50 text-gray-600")}>
                          {p.status}
                        </span>
                        {p.method && (
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", METHOD_COLORS[p.method] || "bg-gray-50 text-gray-600")}>
                            {METHOD_LABELS[p.method as ManualFeePaymentMethod] || p.method}
                          </span>
                        )}
                        {p.referenceNumber && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                            Ref: {p.referenceNumber}
                          </span>
                        )}
                        {p.receiptNumber && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                            {p.receiptNumber}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-bold text-gray-900">₹{p.amount.toLocaleString("en-IN")}</p>
                      <p className="text-xs text-gray-400">{p.paidAt ? format(new Date(p.paidAt), "dd MMM yyyy") : "No payment date"}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        {p.recordedBy ? `Recorded by: ${p.recordedBy.name}` : p.paymentGateway ? "Online Payment" : "Manual Entry"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-semibold"
                      onClick={() => handleViewReceipt(p)}
                    >
                      Receipt
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={structureDialog} onOpenChange={setStructureDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Fee Structure</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {structureError && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{structureError}</p>}
            <div className="space-y-1.5">
              <Label>Fee Name *</Label>
              <Input
                placeholder="e.g. Annual Tuition Fee"
                value={structureForm.name}
                onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                placeholder="12000"
                value={structureForm.amount}
                onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Frequency *</Label>
              <Select value={structureForm.frequency} onValueChange={(v) => setStructureForm({ ...structureForm, frequency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Applicable Class (optional)</Label>
              <Select
                value={structureForm.classId || "all"}
                onValueChange={(v) => setStructureForm({ ...structureForm, classId: v === "all" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStructureDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveStructure} disabled={structureSaving}>
              {structureSaving ? "Saving..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {paymentError && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{paymentError}</p>}
            <div className="space-y-1.5">
              <Label>Student *</Label>
              <Select value={paymentForm.studentId} onValueChange={(v) => setPaymentForm({ ...paymentForm, studentId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.section.class.name}-{s.section.name}, Roll {s.rollNo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Fee Type *</Label>
              <Select value={paymentForm.feeStructureId} onValueChange={onFeeStructureChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fee type" />
                </SelectTrigger>
                <SelectContent>
                  {structures.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — ₹{s.amount.toLocaleString("en-IN")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount Received (₹) *</Label>
              <Input
                type="number"
                placeholder="12000"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment Method *</Label>
                <Select
                  value={paymentForm.method}
                  onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v as ManualFeePaymentMethod })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_FEE_PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <input
                  type="date"
                  value={paymentForm.paidAt}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidAt: e.target.value })}
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference Number (optional)</Label>
              <Input
                placeholder="e.g. UPI-ABC123"
                value={paymentForm.referenceNumber}
                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Remarks (optional)</Label>
              <Input
                placeholder="e.g. July payment"
                value={paymentForm.remarks}
                onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(false)}>
              Cancel
            </Button>
            <Button onClick={savePayment} disabled={paymentSaving}>
              {paymentSaving ? "Recording..." : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptDialog} onOpenChange={setReceiptDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fee Payment Receipt</DialogTitle>
          </DialogHeader>
          {selectedReceiptPayment && (
            <div className="space-y-6 py-4">
              {/* Receipt Content Area */}
              <div id="fee-receipt-print-area" className="border border-gray-200 rounded-xl p-5 bg-white space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="font-bold text-gray-900 text-base">SchoolSync ERP</h4>
                    <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Fee Receipt</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-semibold text-gray-700 bg-gray-100/70 px-2 py-0.5 rounded">
                      {selectedReceiptPayment.receiptNumber || `REC-${selectedReceiptPayment.id.slice(0, 8).toUpperCase()}`}
                    </p>
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <p className="text-gray-400 font-medium">Student Name</p>
                    <p className="font-bold text-gray-800">{selectedReceiptPayment.student.name}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Class / Section</p>
                    <p className="font-bold text-gray-800">
                      Class {selectedReceiptPayment.student.section.class.name} — Sec {selectedReceiptPayment.student.section.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Roll Number</p>
                    <p className="font-semibold text-gray-800">{selectedReceiptPayment.student.rollNo}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Fee Category</p>
                    <p className="font-semibold text-gray-800">{selectedReceiptPayment.feeStructure.name}</p>
                  </div>
                </div>

                {/* Amount Section */}
                <div className="bg-gray-50/80 rounded-xl p-3 flex justify-between items-center border border-gray-100 mt-2">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Amount Paid</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {selectedReceiptPayment.paidAt ? format(new Date(selectedReceiptPayment.paidAt), "dd MMM yyyy") : "—"}
                    </p>
                  </div>
                  <p className="text-xl font-bold text-gray-950">₹{selectedReceiptPayment.amount.toLocaleString("en-IN")}</p>
                </div>

                {/* Additional Info */}
                <div className="grid grid-cols-2 gap-3 text-[11px] pt-1 text-gray-500">
                  <div>
                    <span className="font-medium text-gray-400">Payment Mode:</span>{" "}
                    <span className="font-semibold">
                      {selectedReceiptPayment.method ? (METHOD_LABELS[selectedReceiptPayment.method as ManualFeePaymentMethod] || selectedReceiptPayment.method) : "Manual"}
                    </span>
                  </div>
                  {selectedReceiptPayment.referenceNumber && (
                    <div>
                      <span className="font-medium text-gray-400">Reference:</span>{" "}
                      <span className="font-mono font-semibold">{selectedReceiptPayment.referenceNumber}</span>
                    </div>
                  )}
                </div>

                {/* Footnote */}
                <div className="text-[10px] text-gray-400 text-center border-t border-gray-100 pt-3">
                  This is a computer-generated receipt. No signature is required.
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReceiptDialog(false)}>
                  Close
                </Button>
                <Button className="flex-1 gap-2" onClick={() => {
                  const printWindow = window.open("", "_blank");
                  if (printWindow) {
                    printWindow.document.write(`
                      <html>
                        <head>
                          <title>Receipt - ${selectedReceiptPayment.receiptNumber || 'REC-' + selectedReceiptPayment.id.slice(0, 8).toUpperCase()}</title>
                          <style>
                            body { font-family: system-ui, sans-serif; padding: 40px; color: #111; }
                            .border { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; max-width: 480px; margin: 0 auto; }
                            .flex { display: flex; justify-content: space-between; align-items: start; }
                            .border-b { border-bottom: 1px solid #f3f4f6; padding-bottom: 12px; margin-bottom: 16px; }
                            .grid { display: grid; grid-template-cols: 1fr 1fr; gap: 12px; }
                            .text-xs { font-size: 12px; }
                            .text-sm { font-size: 14px; }
                            .text-xl { font-size: 20px; font-weight: bold; }
                            .font-bold { font-weight: bold; }
                            .font-semibold { font-weight: 600; }
                            .text-gray-400 { color: #9ca3af; }
                            .text-gray-500 { color: #6b7280; }
                            .text-gray-700 { color: #374151; }
                            .bg-gray-100 { background-color: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
                            .bg-muted-box { background-color: #f9fafb; padding: 12px; border-radius: 8px; border: 1px solid #f3f4f6; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
                            .text-center { text-align: center; }
                            .mt-2 { margin-top: 8px; }
                            .pt-3 { padding-top: 12px; border-top: 1px solid #f3f4f6; margin-top: 16px; }
                            @media print { body { padding: 0; } .border { border: none; } }
                          </style>
                        </head>
                        <body>
                          <div class="border">
                            <div class="flex border-b">
                              <div>
                                <h4 class="font-bold" style="margin:0;font-size:18px;">SchoolSync ERP</h4>
                                <p style="margin:2px 0 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Fee Receipt</p>
                              </div>
                              <div style="text-align:right;">
                                <span class="bg-gray-100 font-bold" style="font-size:11px;">${selectedReceiptPayment.receiptNumber || 'REC-' + selectedReceiptPayment.id.slice(0, 8).toUpperCase()}</span>
                              </div>
                            </div>
                            <div class="grid" style="margin-top:16px;">
                              <div>
                                <div class="text-gray-500 text-xs">Student Name</div>
                                <div class="font-bold text-sm">${selectedReceiptPayment.student.name}</div>
                              </div>
                              <div>
                                <div class="text-gray-500 text-xs">Class / Section</div>
                                <div class="font-bold text-sm">Class ${selectedReceiptPayment.student.section.class.name} — Sec ${selectedReceiptPayment.student.section.name}</div>
                              </div>
                              <div style="margin-top:8px;">
                                <div class="text-gray-500 text-xs">Roll Number</div>
                                <div class="font-semibold text-xs">${selectedReceiptPayment.student.rollNo}</div>
                              </div>
                              <div style="margin-top:8px;">
                                <div class="text-gray-500 text-xs">Fee Category</div>
                                <div class="font-semibold text-xs">${selectedReceiptPayment.feeStructure.name}</div>
                              </div>
                            </div>
                            <div class="bg-muted-box">
                              <div>
                                <div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Amount Paid</div>
                                <div style="font-size:11px;color:#6b7280;">${selectedReceiptPayment.paidAt ? format(new Date(selectedReceiptPayment.paidAt), "dd MMM yyyy") : "—"}</div>
                              </div>
                              <div class="text-xl">₹${selectedReceiptPayment.amount.toLocaleString("en-IN")}</div>
                            </div>
                            <div class="flex mt-2" style="font-size:10px;color:#4b5563;">
                              <div>
                                <span class="text-gray-400">Payment Mode:</span> ${selectedReceiptPayment.method ? (METHOD_LABELS[selectedReceiptPayment.method as ManualFeePaymentMethod] || selectedReceiptPayment.method) : "Manual"}
                              </div>
                              ${selectedReceiptPayment.referenceNumber ? `<div><span class="text-gray-400">Reference:</span> ${selectedReceiptPayment.referenceNumber}</div>` : ''}
                            </div>
                            <div class="text-center text-gray-400 pt-3" style="font-size:9px;">
                              This is a computer-generated receipt. No signature is required.
                            </div>
                          </div>
                          <script>
                            window.onload = function() { window.print(); window.close(); }
                          </script>
                        </body>
                      </html>
                    `);
                    printWindow.document.close();
                  }
                }}>
                  Print Receipt
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

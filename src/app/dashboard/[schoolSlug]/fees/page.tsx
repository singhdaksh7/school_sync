"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { IndianRupee, Plus, Trash2, Receipt, TrendingUp, Users, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface FeeStructure { id: string; name: string; amount: number; frequency: string; class: { name: string } | null }
interface Student { id: string; name: string; rollNo: string; section: { name: string; class: { name: string } } }
interface FeePayment {
  id: string; amount: number; paidAt: string; method: string | null; notes: string | null;
  student: { name: string; rollNo: string; section: { name: string; class: { name: string } } };
  feeStructure: { name: string; amount: number };
  recordedBy: { name: string };
}

const FREQUENCY_LABELS: Record<string, string> = {
  ANNUAL: "Annual", MONTHLY: "Monthly", QUARTERLY: "Quarterly", ONE_TIME: "One-time",
};
const FREQUENCY_COLORS: Record<string, string> = {
  ANNUAL: "bg-blue-50 text-blue-700 border-blue-200",
  MONTHLY: "bg-green-50 text-green-700 border-green-200",
  QUARTERLY: "bg-purple-50 text-purple-700 border-purple-200",
  ONE_TIME: "bg-orange-50 text-orange-700 border-orange-200",
};
const METHOD_COLORS: Record<string, string> = {
  CASH: "bg-yellow-50 text-yellow-700", ONLINE: "bg-blue-50 text-blue-700",
  CHEQUE: "bg-purple-50 text-purple-700", UPI: "bg-green-50 text-green-700",
};

type Tab = "structures" | "payments";

export default function FeesPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [tab, setTab] = useState<Tab>("structures");

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Structure dialog
  const [structureDialog, setStructureDialog] = useState(false);
  const [structureForm, setStructureForm] = useState({ name: "", amount: "", frequency: "ANNUAL", classId: "" });
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureError, setStructureError] = useState("");

  // Payment dialog
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ studentId: "", feeStructureId: "", amount: "", method: "CASH", notes: "", paidAt: "" });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetchAll(d.id);
    });
  }, [schoolSlug]);

  async function fetchAll(sid: string) {
    setLoading(true);
    const [structRes, payRes, studRes, classRes] = await Promise.all([
      fetch(`/api/schools/${sid}/fee-structures`),
      fetch(`/api/schools/${sid}/fee-payments`),
      fetch(`/api/schools/${sid}/students`),
      fetch(`/api/schools/${sid}/classes`),
    ]);
    setStructures(await structRes.json());
    setPayments(await payRes.json());
    setStudents(await studRes.json());
    const classData = await classRes.json();
    setClasses(classData.map((c: any) => ({ id: c.id, name: c.name })));
    setLoading(false);
  }

  async function saveStructure() {
    if (!structureForm.name.trim() || !structureForm.amount) { setStructureError("Name and amount are required"); return; }
    setStructureSaving(true); setStructureError("");
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
    if (!res.ok) { setStructureError(data.error); setStructureSaving(false); return; }
    setStructureDialog(false);
    setStructureForm({ name: "", amount: "", frequency: "ANNUAL", classId: "" });
    fetchAll(schoolId);
    setStructureSaving(false);
  }

  async function deleteStructure(id: string) {
    if (!confirm("Delete this fee structure? All payment records will also be deleted.")) return;
    await fetch(`/api/schools/${schoolId}/fee-structures/${id}`, { method: "DELETE" });
    fetchAll(schoolId);
  }

  async function savePayment() {
    if (!paymentForm.studentId || !paymentForm.feeStructureId || !paymentForm.amount) {
      setPaymentError("Student, fee type, and amount are required"); return;
    }
    setPaymentSaving(true); setPaymentError("");
    const res = await fetch(`/api/schools/${schoolId}/fee-payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: paymentForm.studentId,
        feeStructureId: paymentForm.feeStructureId,
        amount: parseFloat(paymentForm.amount),
        method: paymentForm.method || undefined,
        notes: paymentForm.notes || undefined,
        paidAt: paymentForm.paidAt || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setPaymentError(data.error); setPaymentSaving(false); return; }
    setPaymentDialog(false);
    setPaymentForm({ studentId: "", feeStructureId: "", amount: "", method: "CASH", notes: "", paidAt: "" });
    fetchAll(schoolId);
    setPaymentSaving(false);
  }

  // Auto-fill amount when fee structure is selected
  function onFeeStructureChange(id: string) {
    const structure = structures.find((s) => s.id === id);
    setPaymentForm((prev) => ({
      ...prev,
      feeStructureId: id,
      amount: structure ? String(structure.amount) : prev.amount,
    }));
  }

  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
  const thisMonth = payments.filter((p) => {
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
          <p className="text-sm text-gray-500 mt-1">Track fee structures and payment records</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setStructureError(""); setStructureForm({ name: "", amount: "", frequency: "ANNUAL", classId: "" }); setStructureDialog(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Fee Structure
          </Button>
          <Button onClick={() => { setPaymentError(""); setPaymentForm({ studentId: "", feeStructureId: "", amount: "", method: "CASH", notes: "", paidAt: "" }); setPaymentDialog(true); }} className="gap-2" disabled={structures.length === 0 || students.length === 0}>
            <Receipt className="w-4 h-4" /> Record Payment
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Collected</p>
                <p className="text-xl font-bold text-gray-900">₹{totalCollected.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <IndianRupee className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">This Month</p>
                <p className="text-xl font-bold text-gray-900">₹{thisMonthTotal.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Payments</p>
                <p className="text-xl font-bold text-gray-900">{payments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(["structures", "payments"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t === "structures" ? `Fee Structures (${structures.length})` : `Payments (${payments.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : tab === "structures" ? (
        structures.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <IndianRupee className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No fee structures yet</p>
              <p className="text-gray-400 text-sm mt-1">Create fee structures to start recording payments</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {structures.map((s) => (
              <Card key={s.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{s.name}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">₹{s.amount.toLocaleString("en-IN")}</p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className={cn("text-xs", FREQUENCY_COLORS[s.frequency])}>
                          {FREQUENCY_LABELS[s.frequency]}
                        </Badge>
                        {s.class && (
                          <Badge variant="outline" className="text-xs">{s.class.name}</Badge>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" onClick={() => deleteStructure(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : payments.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No payments recorded yet</p>
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
                <div key={p.id} className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-semibold text-sm flex-shrink-0">
                      {p.student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-900">{p.student.name}</p>
                      <p className="text-xs text-gray-400">
                        {p.student.section.class.name} - {p.student.section.name} · Roll {p.student.rollNo}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.feeStructure.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">₹{p.amount.toLocaleString("en-IN")}</p>
                    <p className="text-xs text-gray-400">{format(new Date(p.paidAt), "dd MMM yyyy")}</p>
                    {p.method && (
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5 inline-block", METHOD_COLORS[p.method] || "bg-gray-50 text-gray-600")}>
                        {p.method}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fee Structure Dialog */}
      <Dialog open={structureDialog} onOpenChange={setStructureDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Fee Structure</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {structureError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{structureError}</p>}
            <div className="space-y-1.5">
              <Label>Fee Name *</Label>
              <Input placeholder="e.g. Annual Tuition Fee" value={structureForm.name} onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input type="number" placeholder="12000" value={structureForm.amount} onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Frequency *</Label>
              <Select value={structureForm.frequency} onValueChange={(v) => setStructureForm({ ...structureForm, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Applicable Class (optional)</Label>
              <Select value={structureForm.classId || "all"} onValueChange={(v) => setStructureForm({ ...structureForm, classId: v === "all" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStructureDialog(false)}>Cancel</Button>
            <Button onClick={saveStructure} disabled={structureSaving}>{structureSaving ? "Saving..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {paymentError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{paymentError}</p>}
            <div className="space-y-1.5">
              <Label>Student *</Label>
              <Select value={paymentForm.studentId} onValueChange={(v) => setPaymentForm({ ...paymentForm, studentId: v })}>
                <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                <SelectContent>
                  {structures.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} — ₹{s.amount.toLocaleString("en-IN")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount Paid (₹) *</Label>
              <Input type="number" placeholder="12000" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["CASH", "UPI", "ONLINE", "CHEQUE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <input
                  type="date"
                  value={paymentForm.paidAt}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidAt: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="Optional note..." value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(false)}>Cancel</Button>
            <Button onClick={savePayment} disabled={paymentSaving}>{paymentSaving ? "Saving..." : "Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

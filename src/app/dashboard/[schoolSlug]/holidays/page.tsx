"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, isAfter, startOfToday } from "date-fns";

interface Holiday {
  id: string;
  name: string;
  date: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function HolidaysPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`)
      .then((r) => r.json())
      .then((d) => {
        setSchoolId(d.id);
        fetchData(d.id);
      });
  }, [schoolSlug]);

  async function fetchData(sid: string) {
    setLoading(true);
    const res = await fetch(`/api/schools/${sid}/holidays`);
    setHolidays(await res.json());
    setLoading(false);
  }

  async function save() {
    if (!form.name.trim() || !form.date) { setError("Name and date are required"); return; }
    setSaving(true); setError("");
    const res = await fetch(`/api/schools/${schoolId}/holidays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    setForm({ name: "", date: "" });
    fetchData(schoolId);
    setSaving(false);
  }

  async function deleteHoliday(id: string) {
    if (!confirm("Remove this holiday?")) return;
    await fetch(`/api/schools/${schoolId}/holidays/${id}`, { method: "DELETE" });
    fetchData(schoolId);
  }

  // Group holidays by month
  const grouped = holidays.reduce((acc, h) => {
    const d = new Date(h.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!acc[key]) acc[key] = { label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, items: [] };
    acc[key].items.push(h);
    return acc;
  }, {} as Record<string, { label: string; items: Holiday[] }>);

  const today = startOfToday();
  const upcoming = holidays.filter((h) => isAfter(new Date(h.date), today) || new Date(h.date).toDateString() === today.toDateString());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Holiday Calendar</h2>
          <p className="text-sm text-gray-500 mt-1">
            {upcoming.length > 0
              ? `${upcoming.length} upcoming holiday${upcoming.length > 1 ? "s" : ""}`
              : "No upcoming holidays"}
          </p>
        </div>
        <Button onClick={() => { setForm({ name: "", date: "" }); setError(""); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Add Holiday
        </Button>
      </div>

      {/* Upcoming strip */}
      {upcoming.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Upcoming</p>
          <div className="flex flex-wrap gap-2">
            {upcoming.slice(0, 5).map((h) => (
              <span key={h.id} className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-200 text-amber-800 px-2.5 py-1 rounded-full">
                <CalendarOff className="w-3 h-3" />
                {h.name} — {format(new Date(h.date), "dd MMM")}
              </span>
            ))}
            {upcoming.length > 5 && (
              <span className="text-xs text-amber-600">+{upcoming.length - 5} more</span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : holidays.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <CalendarOff className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No holidays added yet</p>
            <p className="text-gray-400 text-sm mt-1">Add holidays to block attendance marking on those days</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.values(grouped).map((group) => (
            <div key={group.label}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{group.label}</h3>
              <div className="space-y-2">
                {group.items.map((h) => {
                  const d = new Date(h.date);
                  const isPast = d < today;
                  return (
                    <div
                      key={h.id}
                      className={`flex items-center justify-between px-4 py-3 rounded-lg border ${isPast ? "bg-gray-50 border-gray-100" : "bg-white border-gray-200"}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center text-center flex-shrink-0 ${isPast ? "bg-gray-100" : "bg-red-50"}`}>
                          <p className={`text-xs font-bold leading-none ${isPast ? "text-gray-400" : "text-red-600"}`}>{format(d, "dd")}</p>
                          <p className={`text-[9px] leading-none mt-0.5 ${isPast ? "text-gray-400" : "text-red-400"}`}>{format(d, "MMM")}</p>
                        </div>
                        <div>
                          <p className={`font-medium text-sm ${isPast ? "text-gray-400" : "text-gray-900"}`}>{h.name}</p>
                          <p className="text-xs text-gray-400">{format(d, "EEEE")}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-400 hover:text-red-600"
                        onClick={() => deleteHoliday(h.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5">
              <Label>Holiday Name *</Label>
              <Input
                placeholder="e.g. Diwali, Republic Day"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Adding..." : "Add Holiday"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

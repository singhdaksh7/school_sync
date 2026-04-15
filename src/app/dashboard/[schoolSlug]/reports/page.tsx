"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BarChart2, Users, GraduationCap, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Section { id: string; name: string; class: { name: string } }
interface SummaryEntry {
  id: string;
  name: string;
  rollNo?: string;
  subject?: string;
  sectionLabel?: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

export default function ReportsPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [mode, setMode] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [sectionId, setSectionId] = useState("all");
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [summary, setSummary] = useState<SummaryEntry[]>([]);
  const [totalDays, setTotalDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "pct_asc" | "pct_desc">("name");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetch(`/api/schools/${d.id}/classes`).then((r) => r.json()).then((classesData) => {
        const allSections: Section[] = classesData.flatMap((c: any) =>
          c.sections.map((s: any) => ({ id: s.id, name: s.name, class: { name: c.name } }))
        );
        setSections(allSections);
      });
    });
  }, [schoolSlug]);

  async function fetchReport() {
    if (!schoolId) return;
    setLoading(true);
    const url = `/api/schools/${schoolId}/attendance/summary?from=${from}&to=${to}&type=${mode}${mode === "STUDENT" && sectionId !== "all" ? `&sectionId=${sectionId}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    setSummary(data.summary || []);
    setTotalDays(data.totalDays || 0);
    setLoading(false);
  }

  const filtered = summary.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.rollNo && s.rollNo.toLowerCase().includes(search.toLowerCase()))
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "pct_asc") return (a.present / (a.total || 1)) - (b.present / (b.total || 1));
    if (sortBy === "pct_desc") return (b.present / (b.total || 1)) - (a.present / (a.total || 1));
    return a.name.localeCompare(b.name);
  });

  const avgPct = summary.length > 0
    ? Math.round(summary.reduce((acc, s) => acc + (s.present / (s.total || 1)), 0) / summary.length * 100)
    : null;
  const belowThreshold = summary.filter((s) => s.total > 0 && (s.present / s.total) < 0.75).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Attendance Reports</h2>
        <p className="text-sm text-gray-500 mt-1">View attendance analytics over a date range</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type</p>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["STUDENT", "TEACHER"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setSummary([]); }}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
                      mode === m ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {m === "STUDENT" ? <GraduationCap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    {m === "STUDENT" ? "Students" : "Teachers"}
                  </button>
                ))}
              </div>
            </div>
            {mode === "STUDENT" && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section</p>
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sections</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.class.name} - {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">From</p>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">To</p>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Button onClick={fetchReport} disabled={loading} className="gap-2">
              <BarChart2 className="w-4 h-4" />
              {loading ? "Loading..." : "Generate Report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5 pb-5">
                <p className="text-sm text-gray-500 font-medium">Average Attendance</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{avgPct}%</p>
                <p className="text-xs text-gray-400 mt-1">{totalDays} days in range</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-5">
                <p className="text-sm text-gray-500 font-medium">Total {mode === "STUDENT" ? "Students" : "Teachers"}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{summary.length}</p>
                <p className="text-xs text-gray-400 mt-1">with at least one record</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-5">
                <p className="text-sm text-gray-500 font-medium">Below 75%</p>
                <p className={cn("text-3xl font-bold mt-1", belowThreshold > 0 ? "text-red-600" : "text-green-600")}>
                  {belowThreshold}
                </p>
                <p className="text-xs text-gray-400 mt-1">need attention</p>
              </CardContent>
            </Card>
          </div>

          {/* Table controls */}
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by Name</SelectItem>
                <SelectItem value="pct_desc">Highest % First</SelectItem>
                <SelectItem value="pct_asc">Lowest % First</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Results table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {mode === "STUDENT" ? "Student" : "Teacher"} Attendance — {from} to {to}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Name</th>
                    {mode === "STUDENT" && <th className="text-left py-2 px-3 text-gray-500 font-medium">Roll</th>}
                    {mode === "STUDENT" && <th className="text-left py-2 px-3 text-gray-500 font-medium">Section</th>}
                    {mode === "TEACHER" && <th className="text-left py-2 px-3 text-gray-500 font-medium">Subject</th>}
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">Present</th>
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">Absent</th>
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">Late</th>
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">Total</th>
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">%</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((entry) => {
                    const pct = entry.total > 0 ? Math.round((entry.present / entry.total) * 100) : 0;
                    const isLow = entry.total > 0 && pct < 75;
                    return (
                      <tr key={entry.id} className={cn("border-b border-gray-50 hover:bg-gray-50", isLow && "bg-red-50/30")}>
                        <td className="py-2.5 px-3 font-medium text-gray-900">{entry.name}</td>
                        {mode === "STUDENT" && <td className="py-2.5 px-3 text-gray-500">{entry.rollNo}</td>}
                        {mode === "STUDENT" && <td className="py-2.5 px-3 text-gray-500 text-xs">{entry.sectionLabel}</td>}
                        {mode === "TEACHER" && <td className="py-2.5 px-3 text-gray-500 text-xs">{entry.subject || "—"}</td>}
                        <td className="py-2.5 px-3 text-center">
                          <span className="font-semibold text-green-700">{entry.present}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={cn("font-semibold", entry.absent > 0 ? "text-red-600" : "text-gray-400")}>{entry.absent}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={cn("font-semibold", entry.late > 0 ? "text-yellow-600" : "text-gray-400")}>{entry.late}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-gray-600">{entry.total}</td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <Badge
                              variant="secondary"
                              className={cn("text-xs min-w-[3rem] justify-center",
                                pct >= 75 ? "bg-green-100 text-green-700" : pct >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                              )}
                            >
                              {pct}%
                            </Badge>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {isLow && <Badge variant="destructive" className="text-xs">Low</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {summary.length === 0 && !loading && (
        <Card>
          <CardContent className="py-20 text-center">
            <BarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No data yet</p>
            <p className="text-gray-400 text-sm mt-1">Select filters and click Generate Report</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

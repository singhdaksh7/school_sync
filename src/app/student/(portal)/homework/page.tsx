"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { BookOpenCheck, Search, Paperclip, User, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

interface HomeworkSummary {
  totalAssigned: number;
  completedCount: number;
  missedCount: number;
  completionPercentage: number | null;
}

interface HomeworkItem {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  assignedAt: string;
  dueDate: string;
  attachmentUrl: string | null;
  teacher: { id: string; name: string };
}

type Category = "ALL" | "TODAY" | "YESTERDAY" | "LAST_7_DAYS";

export default function StudentHomeworkPage() {
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("ALL");
  const [category, setCategory] = useState<Category>("ALL");
  const [selected, setSelected] = useState<HomeworkItem | null>(null);
  const [summary, setSummary] = useState<HomeworkSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/homework")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setHomework(d.homework || []); })
      .finally(() => setLoading(false));
    fetch("/api/student/homework-summary")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setSummary(d); })
      .finally(() => setSummaryLoading(false));
  }, []);

  const subjects = useMemo(() => Array.from(new Set(homework.map((h) => h.subject))).sort(), [homework]);

  const filtered = useMemo(() => {
    return homework.filter((hw) => {
      const due = new Date(hw.dueDate);
      if (category === "TODAY" && !isToday(due)) return false;
      if (category === "YESTERDAY" && !isYesterday(due)) return false;
      if (category === "LAST_7_DAYS") {
        const sevenAgo = new Date();
        sevenAgo.setDate(sevenAgo.getDate() - 7);
        sevenAgo.setHours(0, 0, 0, 0);
        if (due < sevenAgo) return false;
      }
      if (subject !== "ALL" && hw.subject !== subject) return false;
      if (search && !`${hw.title} ${hw.description ?? ""} ${hw.subject}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [homework, category, subject, search]);

  const categories: { key: Category; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "TODAY", label: "Today" },
    { key: "YESTERDAY", label: "Yesterday" },
    { key: "LAST_7_DAYS", label: "Last 7 Days" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Homework</h1>
        <p className="mt-1 text-sm text-muted-foreground">View homework assigned to your class. Submissions are managed by your teacher.</p>
      </div>

      {summaryLoading ? (
        <Skeleton className="h-28" />
      ) : summary && summary.totalAssigned > 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-wrap items-center gap-6 p-4">
            <CircularProgress value={summary.completionPercentage ?? 0} size={84} strokeWidth={9} />
            <div className="flex-1 min-w-[200px] space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {summary.completedCount}/{summary.totalAssigned} homework completed
              </p>
              <Progress value={summary.completionPercentage ?? 0} toned />
              <p className="text-xs text-muted-foreground">{summary.missedCount} missed</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search homework..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              category === c.key ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <BookOpenCheck className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-foreground">No homework found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different filter or search term.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((hw) => (
            <Card
              key={hw.id}
              className="cursor-pointer border-border transition-all hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => setSelected(hw)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{hw.subject}</Badge>
                      {isToday(new Date(hw.dueDate)) && <Badge variant="warning">Due Today</Badge>}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-foreground">{hw.title}</p>
                    {hw.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hw.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> {hw.teacher.name}</span>
                      <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Due {format(new Date(hw.dueDate), "dd MMM yyyy")}</span>
                      {hw.attachmentUrl && <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" /> Attachment</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>{selected.subject}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {selected.description && <p className="text-foreground">{selected.description}</p>}
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Teacher</p>
                    <p className="font-medium text-foreground">{selected.teacher.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date Assigned</p>
                    <p className="font-medium text-foreground">{format(new Date(selected.assignedAt), "dd MMM yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Due Date</p>
                    <p className="font-medium text-foreground">{format(new Date(selected.dueDate), "dd MMM yyyy")}</p>
                  </div>
                </div>
                {selected.attachmentUrl && (
                  <a
                    href={selected.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-primary hover:bg-muted/50"
                  >
                    <Paperclip className="h-4 w-4" /> View Attachment
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

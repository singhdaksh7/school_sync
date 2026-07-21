"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Megaphone, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  createdBy: { name: string; role: string };
  isRead?: boolean;
}

export default function StudentAnnouncementsPage() {
  const { t } = useTranslation();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  useEffect(() => {
    fetch("/api/student/announcements")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAnnouncements(d.announcements || []); })
      .finally(() => setLoading(false));
  }, []);

  function markRead(id: string) {
    setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
    void fetch(`/api/student/announcements/${id}/read`, { method: "POST" });
  }

  const filtered = useMemo(() => {
    return announcements.filter((a) => {
      if (search && !`${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (dateFilter && a.publishedAt && format(new Date(a.publishedAt), "yyyy-MM-dd") !== dateFilter) return false;
      return true;
    });
  }, [announcements, search, dateFilter]);

  const unreadCount = announcements.filter((a) => !a.isRead).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("studentAnnouncements.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("studentAnnouncements.subtitle")}</p>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {t("studentAnnouncements.unreadCount", { count: unreadCount })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("studentAnnouncements.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-48"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <Megaphone className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-foreground">{t("studentAnnouncements.noAnnouncementsFound")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card
              key={a.id}
              className="border-border transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => !a.isRead && markRead(a.id)}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !a.isRead) markRead(a.id); }}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Megaphone className="h-5 w-5" />
                    {!a.isRead && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary" aria-label={t("studentAnnouncements.unread")} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-foreground">{a.title}</p>
                      {a.publishedAt && <p className="text-xs text-muted-foreground">{format(new Date(a.publishedAt), "dd MMM yyyy")}</p>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{t("studentAnnouncements.byAuthor", { name: a.createdBy.name })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

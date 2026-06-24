"use client";

import { useEffect, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, CheckCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Notification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  school: { id: string; name: string } | null;
};

type ListResponse = { notifications: Notification[]; total: number; page: number; totalPages: number; unreadCount: number };

export default function NotificationsClient() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) setLoading(true);
    }, 0);
    fetch(`/api/founder/notifications?page=${page}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ListResponse | null) => {
        if (active && json) setData(json);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      clearTimeout(id);
      active = false;
    };
  }, [page, refreshKey]);

  async function markRead(id: string) {
    await fetch(`/api/founder/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    setRefreshKey((k) => k + 1);
  }

  async function markAllRead() {
    await fetch("/api/founder/notifications/mark-all-read", { method: "PATCH" });
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("nav.notifications")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? t("founder.unreadCount", { count: data.unreadCount }) : t("common.loading")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1.5">
          <CheckCheck className="h-3.5 w-3.5" /> {t("founder.markAllRead")}
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("founder.allNotifications")}{data ? ` (${data.total})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : !data || data.notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <Bell className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("founder.noNotificationsFound")}</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/60">
                {data.notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.isRead && markRead(n.id)}
                    className={`block w-full py-3 text-left transition-colors first:pt-0 last:pb-0 ${n.isRead ? "" : "rounded-md bg-indigo-500/5 px-2"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {!n.isRead && <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-600" />}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.createdAt)}</p>
                  </button>
                ))}
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
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { notificationIcon, notificationLabelKey, notificationDeepLink, relativeTimeFromNow, type NotificationRole, type NotificationDisplayItem } from "@/lib/notification-display";

export interface NotificationsPageContentProps {
  role: NotificationRole;
  basePath: string;
  rolePrefix: string;
  fetchImpl?: typeof fetch;
}

interface ListResponse {
  items: NotificationDisplayItem[];
  nextCursor: string | null;
}

export default function NotificationsPageContent({ role, basePath, rolePrefix, fetchImpl }: NotificationsPageContentProps) {
  const { t } = useTranslation();
  const doFetch = fetchImpl ?? fetch;
  const [items, setItems] = useState<NotificationDisplayItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  function load(reset: boolean, filterUnread: boolean) {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(false);
    const params = new URLSearchParams({ limit: "20" });
    if (filterUnread) params.set("unreadOnly", "true");
    if (!reset && cursor) params.set("cursor", cursor);
    doFetch(`${basePath}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: ListResponse) => {
        setItems((prev) => (reset ? d.items : [...prev, ...d.items]));
        setCursor(d.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }

  useEffect(() => {
    const id = window.setTimeout(() => load(true, unreadOnly), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly, basePath]);

  function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    doFetch(`${basePath}/${id}/read`, { method: "PATCH" }).catch(() => {});
  }

  function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    doFetch(`${basePath}/mark-all-read`, { method: "PATCH" }).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t("notifications.title")}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${unreadOnly ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {unreadOnly ? t("notifications.showingUnread") : t("notifications.showAll")}
          </button>
          <button onClick={markAllRead} className="text-xs font-medium text-primary hover:underline">
            {t("notifications.markAllRead")}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
          <p>{t("notifications.loadError")}</p>
          <button onClick={() => load(true, unreadOnly)} className="text-primary hover:underline">{t("common.retry")}</button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("notifications.empty")}</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {items.map((item) => {
            const Icon = notificationIcon(item.eventType);
            const href = notificationDeepLink(role, item.entityType, rolePrefix);
            const rel = relativeTimeFromNow(item.createdAt);
            const timeLabel = rel.value !== undefined ? t(`notifications.time.${rel.key}`, { count: rel.value }) : t(`notifications.time.${rel.key}`);
            const inner = (
              <div className={`flex gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-muted/60 ${!item.readAt ? "bg-primary/5" : ""}`}>
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{t(notificationLabelKey(item.eventType))}</p>
                  <p className="text-xs text-muted-foreground">{timeLabel}</p>
                </div>
                {!item.readAt && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden="true" />}
              </div>
            );
            return href ? (
              <Link key={item.id} href={href} onClick={() => markRead(item.id)}>
                {inner}
              </Link>
            ) : (
              <button key={item.id} onClick={() => markRead(item.id)} className="block w-full text-left">
                {inner}
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && cursor && (
        <div className="flex justify-center">
          <button
            onClick={() => load(false, unreadOnly)}
            disabled={loadingMore}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {loadingMore ? t("common.loading") : t("notifications.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

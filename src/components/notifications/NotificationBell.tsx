"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { notificationIcon, notificationLabelKey, notificationDeepLink, relativeTimeFromNow, type NotificationRole, type NotificationDisplayItem } from "@/lib/notification-display";

export interface NotificationBellProps {
  role: NotificationRole;
  basePath: string; // e.g. "/api/teacher/notifications"
  /** URL root for this recipient's shell (e.g. "/teacher", "/dashboard/<slug>") — used to build deep links. */
  rolePrefix: string;
  /** Injected per-shell so the parent portal's bearer-token fetch (useParentFetch) can be reused instead of a second auth scheme. */
  fetchImpl?: typeof fetch;
  /** Full inbox page path for "view all". */
  viewAllHref: string;
}

interface ListResponse {
  items: NotificationDisplayItem[];
  nextCursor: string | null;
}

export default function NotificationBell({ role, basePath, rolePrefix, fetchImpl, viewAllHref }: NotificationBellProps) {
  const { t } = useTranslation();
  const doFetch = fetchImpl ?? fetch;
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationDisplayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const id = window.setTimeout(() => {
      doFetch(`${basePath}/unread-count`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((d) => { if (active) setUnreadCount(d.unreadCount ?? 0); })
        .catch(() => {});
    }, 0);
    return () => { active = false; window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function loadRecent() {
    setLoading(true);
    setError(false);
    doFetch(`${basePath}?limit=8`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: ListResponse) => setItems(d.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) loadRecent();
      return next;
    });
  }

  function markOneRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    doFetch(`${basePath}/${id}/read`, { method: "PATCH" }).catch(() => {});
  }

  function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    doFetch(`${basePath}/mark-all-read`, { method: "PATCH" }).catch(() => {});
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggleOpen}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("common.notifications")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">{t("notifications.title")}</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-primary hover:underline">
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
              </div>
            )}
            {!loading && error && (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <p>{t("notifications.loadError")}</p>
                <button onClick={loadRecent} className="text-primary hover:underline">{t("common.retry")}</button>
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</p>
            )}
            {!loading && !error && items.map((item) => {
              const Icon = notificationIcon(item.eventType);
              const href = notificationDeepLink(role, item.entityType, rolePrefix);
              const rel = relativeTimeFromNow(item.createdAt);
              const timeLabel = rel.value !== undefined ? t(`notifications.time.${rel.key}`, { count: rel.value }) : t(`notifications.time.${rel.key}`);
              const content = (
                <div className={`flex gap-3 border-b border-border/60 px-3 py-3 last:border-0 hover:bg-muted/60 ${!item.readAt ? "bg-primary/5" : ""}`}>
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{t(notificationLabelKey(item.eventType))}</p>
                    <p className="text-xs text-muted-foreground">{timeLabel}</p>
                  </div>
                  {!item.readAt && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                </div>
              );
              return href ? (
                <Link key={item.id} href={href} onClick={() => { markOneRead(item.id); setOpen(false); }}>
                  {content}
                </Link>
              ) : (
                <button key={item.id} onClick={() => markOneRead(item.id)} className="block w-full text-left">
                  {content}
                </button>
              );
            })}
          </div>

          <Link
            href={viewAllHref}
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-muted/60"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}

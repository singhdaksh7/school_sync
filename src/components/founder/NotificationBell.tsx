"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
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

export default function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/founder/notifications?page=1", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { notifications: Notification[]; unreadCount: number } | null) => {
        if (!json) return;
        setNotifications(json.notifications.slice(0, 8));
        setUnreadCount(json.unreadCount);
      });
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/founder/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    load();
  }

  function toggleOpen() {
    setOpen((v) => {
      if (!v) load();
      return !v;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggleOpen}
        className="relative flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        aria-label={t("nav.notifications")}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">{t("nav.notifications")}</p>
            <Link href="/founder/notifications" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(false)}>
              {t("founder.viewAll")}
            </Link>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("founder.noNotificationsYet")}</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={`block w-full border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50 ${n.isRead ? "" : "bg-indigo-500/5"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {!n.isRead && <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-600" />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

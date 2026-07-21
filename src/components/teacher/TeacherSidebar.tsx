"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap, LayoutDashboard, ClipboardCheck, CalendarDays,
  FileText, BookOpenCheck, RefreshCw, DoorOpen, ClipboardList,
  User, X, Award, Sparkles, BookCheck, ShieldAlert, Megaphone, Library
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useState, useEffect } from "react";

export interface TeacherNavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
}

export const TEACHER_NAV_ITEMS: TeacherNavItem[] = [
  { href: "/teacher", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/teacher/attendance", labelKey: "nav.attendance", icon: ClipboardCheck },
  { href: "/teacher/timetable", labelKey: "nav.timetable", icon: CalendarDays },
  { href: "/teacher/marks", labelKey: "nav.marks", icon: FileText },
  { href: "/teacher/report-cards", labelKey: "nav.reportCards", icon: Award },
  { href: "/teacher/homework", labelKey: "nav.homework", icon: BookOpenCheck },
  { href: "/teacher/announcements", labelKey: "nav.announcements", icon: Megaphone },
  { href: "/teacher/notebook", labelKey: "nav.notebookChecking", icon: BookCheck },
  { href: "/teacher/library", labelKey: "nav.library", icon: Library },
  { href: "/teacher/arrangements", labelKey: "nav.arrangements", icon: RefreshCw },
  { href: "/teacher/early-leave", labelKey: "nav.earlyLeave", icon: DoorOpen },
  { href: "/teacher/leaves", labelKey: "nav.leaves", icon: ClipboardList },
  { href: "/teacher/profile", labelKey: "nav.profile", icon: User },
];

interface TeacherSidebarProps {
  schoolName?: string;
  collapsed?: boolean;
  onClose?: () => void;
}

export default function TeacherSidebar({ schoolName, collapsed = false, onClose }: TeacherSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const base = "/teacher";

  const [isEffectiveHead, setIsEffectiveHead] = useState(false);
  const [poweredBy, setPoweredBy] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && data.poweredBySchoolSync !== undefined) {
          setPoweredBy(data.poweredBySchoolSync);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      try {
        const res = await fetch("/api/teacher/operational-roles/self-status");
        if (res.ok) {
          const data = await res.json();
          if (active) setIsEffectiveHead(!!data.isEffectiveOperationsHead);
        } else {
          if (active) setIsEffectiveHead(false);
        }
      } catch (e) {
        if (active) setIsEffectiveHead(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const navItems = isEffectiveHead
    ? [
        { href: "/teacher", labelKey: "nav.dashboard", icon: LayoutDashboard },
        { href: "/teacher/operations", labelKey: "nav.schoolOperations", icon: ShieldAlert },
        ...TEACHER_NAV_ITEMS.filter((item) => item.href !== "/teacher"),
      ]
    : TEACHER_NAV_ITEMS;

  return (
    <aside
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-300 md:m-2.5 md:h-[calc(100%-1.25rem)] md:rounded-2xl md:border md:border-sidebar-border md:shadow-sm",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand block */}
      <div className={cn("p-3", collapsed && "px-2")}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl p-3",
            collapsed && "justify-center p-2"
          )}
          style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.04))" }}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-md"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}
          >
            <GraduationCap className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{schoolName || "SchoolSync"}</p>
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <Sparkles className="h-2.5 w-2.5" /> {t("nav.teacherPortal")}
              </span>
            </div>
          )}
          {onClose && !collapsed && (
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground md:hidden"
              aria-label={t("common.closeMenu")}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("common.menu")}
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Teacher navigation" className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          const label = t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed && "justify-center px-0",
                active
                  ? "bg-primary font-semibold text-primary-foreground shadow-md shadow-primary/25"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {active && !collapsed && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-x-1.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" />
              )}
              <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      {poweredBy && (
        <div className="p-3">
          <div
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground",
              collapsed && "px-0"
            )}
          >
            <Sparkles className="h-3 w-3 text-primary" />
            {!collapsed && (
              <span>
                {t("common.poweredBy")} <span className="font-bold text-foreground">SchoolSync</span>
              </span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

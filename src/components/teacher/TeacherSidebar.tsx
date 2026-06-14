"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap, LayoutDashboard, ClipboardCheck, CalendarDays,
  FileText, BookOpenCheck, RefreshCw, DoorOpen, ClipboardList,
  User, X, Award, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TeacherNavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export const TEACHER_NAV_ITEMS: TeacherNavItem[] = [
  { href: "/teacher", label: "Dashboard", icon: LayoutDashboard },
  { href: "/teacher/attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "/teacher/timetable", label: "Timetable", icon: CalendarDays },
  { href: "/teacher/marks", label: "Marks", icon: FileText },
  { href: "/teacher/report-cards", label: "Report Cards", icon: Award },
  { href: "/teacher/homework", label: "Homework", icon: BookOpenCheck },
  { href: "/teacher/arrangements", label: "Arrangements", icon: RefreshCw },
  { href: "/teacher/early-leave", label: "Early Leave", icon: DoorOpen },
  { href: "/teacher/leaves", label: "Leaves", icon: ClipboardList },
  { href: "/teacher/profile", label: "Profile", icon: User },
];

interface TeacherSidebarProps {
  schoolName?: string;
  collapsed?: boolean;
  onClose?: () => void;
}

export default function TeacherSidebar({ schoolName, collapsed = false, onClose }: TeacherSidebarProps) {
  const pathname = usePathname();
  const base = "/teacher";

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
                <Sparkles className="h-2.5 w-2.5" /> Teacher Portal
              </span>
            </div>
          )}
          {onClose && !collapsed && (
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground md:hidden"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Menu
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Teacher navigation" className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {TEACHER_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
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
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
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
              Powered by <span className="font-bold text-foreground">SchoolSync</span>
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

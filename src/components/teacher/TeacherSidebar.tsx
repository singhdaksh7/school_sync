"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap, LayoutDashboard, ClipboardCheck, CalendarDays,
  FileText, BookOpenCheck, RefreshCw, DoorOpen, ClipboardList,
  User, X, Award,
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
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand + mobile close */}
      <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "justify-center px-0")}>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}
        >
          <GraduationCap className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{schoolName || "SchoolSync"}</p>
            <p className="text-[11px] text-muted-foreground">Teacher Portal</p>
          </div>
        )}
        {onClose && !collapsed && (
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Teacher
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Teacher navigation" className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {TEACHER_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed && "justify-center px-0",
                active
                  ? "bg-primary font-medium text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="text-center text-[10px] text-muted-foreground">
            Powered by <span className="font-semibold text-foreground">SchoolSync</span>
          </div>
        )}
      </div>
    </aside>
  );
}

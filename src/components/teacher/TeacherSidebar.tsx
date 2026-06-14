"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  GraduationCap, LayoutDashboard, ClipboardCheck, CalendarDays,
  FileText, BookOpenCheck, RefreshCw, DoorOpen, ClipboardList,
  User, LogOut, X, Award,
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
        "flex h-full flex-col border-r border-gray-200 bg-white transition-[width] duration-300 dark:border-gray-800 dark:bg-gray-950",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand + mobile close */}
      <div className={cn("flex items-center gap-2.5 border-b border-gray-100 px-4 py-5 dark:border-gray-800", collapsed && "justify-center px-0")}>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600">
          <GraduationCap className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{schoolName || "SchoolSync"}</p>
            <p className="text-xs text-gray-400">Teacher Portal</p>
          </div>
        )}
        {onClose && !collapsed && (
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 md:hidden dark:hover:bg-gray-800"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Teacher navigation" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {TEACHER_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                collapsed && "justify-center px-0",
                active
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5 flex-shrink-0",
                  active ? "text-blue-600 dark:text-blue-400" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                )}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-gray-300 dark:hover:bg-red-950 dark:hover:text-red-400",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-red-500" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}

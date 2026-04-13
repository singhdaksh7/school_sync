"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap, LayoutDashboard, Users, BookOpen,
  ClipboardCheck, Settings, UserPlus, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  school: { slug: string; name: string; logoUrl?: string | null };
  userRole: string;
}

export default function Sidebar({ school, userRole }: SidebarProps) {
  const pathname = usePathname();
  const base = `/dashboard/${school.slug}`;

  const navItems = [
    { href: base, label: "Overview", icon: LayoutDashboard },
    { href: `${base}/classes`, label: "Classes & Sections", icon: BookOpen },
    { href: `${base}/teachers`, label: "Teachers", icon: Users },
    { href: `${base}/students`, label: "Students", icon: GraduationCap },
    { href: `${base}/attendance`, label: "Attendance", icon: ClipboardCheck },
    ...(userRole === "SCHOOL_OWNER"
      ? [{ href: `${base}/invite`, label: "Invite Admins", icon: UserPlus }]
      : []),
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <GraduationCap className="w-4.5 h-4.5 text-white w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{school.name}</p>
            <p className="text-xs text-gray-400">SchoolSync</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <item.icon className={cn("w-4.5 h-4.5 flex-shrink-0 w-5 h-5", active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")} />
              {item.label}
              {active && <ChevronRight className="w-3.5 h-3.5 ml-auto text-blue-500" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom role badge */}
      <div className="px-4 py-3 border-t border-gray-100">
        <span className={cn(
          "text-xs font-medium px-2 py-0.5 rounded-full",
          userRole === "SCHOOL_OWNER" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
        )}>
          {userRole === "SCHOOL_OWNER" ? "Owner" : "Admin"}
        </span>
      </div>
    </aside>
  );
}

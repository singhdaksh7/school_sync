"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Menu, PanelLeft, Bell, User, LogOut, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TeacherHeaderProps {
  schoolName?: string;
  teacherName?: string;
  onMenuClick?: () => void;
  onCollapseToggle?: () => void;
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TeacherHeader({ schoolName, teacherName, onMenuClick, onCollapseToggle }: TeacherHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const initials = (teacherName || "")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur md:px-6">
      {/* Left: menu toggles + school */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={onCollapseToggle}
          className="hidden rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">{schoolName || "SchoolSync"}</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">{todayLabel()}</p>
        </div>
      </div>

      {/* Right: bell + profile */}
      <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
        <button
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Profile menu"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials || <User className="h-4 w-4" />}
            </span>
            <span className="hidden text-sm font-medium text-foreground sm:block">{teacherName || "Teacher"}</span>
            <ChevronDown className={cn("hidden h-4 w-4 text-muted-foreground transition-transform sm:block", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{teacherName || "Teacher"}</p>
                <p className="truncate text-xs text-muted-foreground">{schoolName}</p>
              </div>
              <Link
                href="/teacher/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <User className="h-4 w-4 text-muted-foreground" /> My Profile
              </Link>
              <button
                role="menuitem"
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

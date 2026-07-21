"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, Bell, User, LogOut, ChevronDown, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { guardianLogout } from "@/lib/guardian-auth-client";
import { useGuardianContext } from "./GuardianContext";

interface GuardianHeaderProps {
  schoolName?: string;
  onMenuClick?: () => void;
}

function todayLabel() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

export default function GuardianHeader({ schoolName, onMenuClick }: GuardianHeaderProps) {
  const { t } = useTranslation();
  const { user, children, selectedChildId, setSelectedChildId } = useGuardianContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [childMenuOpen, setChildMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const childMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !childMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (childMenuRef.current && !childMenuRef.current.contains(e.target as Node)) setChildMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setMenuOpen(false); setChildMenuOpen(false); }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, childMenuOpen]);

  const guardianName = user?.name || t("common.roleTeacher");
  const initials = guardianName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const selectedChild = children.find((c) => c.id === selectedChildId);

  function handleLogout() {
    void guardianLogout();
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/60 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:px-6 relative">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label={t("common.openMenu")}
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">{schoolName || "SchoolSync"}</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">{todayLabel()}</p>
        </div>
      </div>

      <LanguageSwitcher className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:flex" />

      <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
        {children.length > 0 && (
          <div className="relative" ref={childMenuRef}>
            <button
              onClick={() => setChildMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-haspopup="menu"
              aria-expanded={childMenuOpen}
            >
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">{selectedChild ? selectedChild.name : t("guardian.selectChild")}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", childMenuOpen && "rotate-180")} />
            </button>
            {childMenuOpen && (
              <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
                {children.map((child) => (
                  <button
                    key={child.id}
                    role="menuitem"
                    onClick={() => { setSelectedChildId(child.id); setChildMenuOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      child.id === selectedChildId ? "font-semibold text-primary" : "text-foreground"
                    )}
                  >
                    <span className="truncate">{child.name}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">{child.section.class.name}-{child.section.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("common.notifications")}
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("common.profileMenu")}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials || <User className="h-4 w-4" />}
            </span>
            <span className="hidden text-sm font-medium text-foreground sm:block">{guardianName}</span>
            <ChevronDown className={cn("hidden h-4 w-4 text-muted-foreground transition-transform sm:block", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div role="menu" className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{guardianName}</p>
                <p className="truncate text-xs text-muted-foreground">{schoolName}</p>
              </div>
              <button
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
              >
                <LogOut className="h-4 w-4" /> {t("common.logout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

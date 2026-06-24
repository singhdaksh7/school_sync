"use client";

import { signOut } from "next-auth/react";
import { LogOut, User, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface HeaderProps {
  school: { name: string };
  user: { name?: string | null; email?: string | null };
  onMenuClick?: () => void;
}

export default function Header({ school, user, onMenuClick }: HeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/60 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:px-6 relative">
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — visible on mobile only */}
        <button
          onClick={onMenuClick}
          className="flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted md:hidden"
          aria-label={t("common.openMenu")}
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-sm font-medium text-muted-foreground">{school.name}</h1>
        <LanguageSwitcher className="sm:hidden" />
      </div>

      <LanguageSwitcher className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:flex" />

      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <User className="h-4 w-4" />
          </div>
          <span className="hidden font-medium sm:block">{user.name}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="gap-1.5 text-muted-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t("common.signOut")}</span>
        </Button>
      </div>
    </header>
  );
}

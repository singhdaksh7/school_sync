"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { LogOut, ShieldCheck, Menu, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FounderHeaderProps {
  user: { name?: string | null; email?: string | null };
  onMenuClick?: () => void;
}

export default function FounderHeader({ user, onMenuClick }: FounderHeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/60 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-sm font-medium text-muted-foreground">Platform Overview</h1>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {mounted && (
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        )}
        <div className="flex items-center gap-2 text-sm text-foreground">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="hidden font-medium sm:block">{user.name}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/founder/login" })}
          className="gap-1.5 text-muted-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

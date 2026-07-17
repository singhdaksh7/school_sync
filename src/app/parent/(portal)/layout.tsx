"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { ParentAuthProvider, useRequireParentAuth } from "@/lib/parent-web-auth";
import ParentSidebar from "@/components/parent/ParentSidebar";
import { useTranslation } from "@/lib/i18n/LanguageContext";

function ParentPortalShell({ children }: { children: React.ReactNode }) {
  const { token, ready } = useRequireParentAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();

  if (!ready || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label={t("common.loading")} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <div className="hidden md:block">
        <ParentSidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-50 h-full">
            <ParentSidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label={t("common.menu")} className="rounded-lg p-2 text-foreground hover:bg-muted">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-foreground">{t("nav.parentPortal")}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function ParentPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ParentAuthProvider>
      <ParentPortalShell>{children}</ParentPortalShell>
    </ParentAuthProvider>
  );
}

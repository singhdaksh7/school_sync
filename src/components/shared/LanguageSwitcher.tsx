"use client";

import { Languages } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { localeNames, type Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Languages className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label={t("common.language")}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {(Object.keys(localeNames) as Locale[]).map((code) => (
          <option key={code} value={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
    </div>
  );
}

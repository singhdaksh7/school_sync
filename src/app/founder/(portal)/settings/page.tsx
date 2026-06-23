"use client";

import { Settings } from "lucide-react";
import FounderComingSoon from "@/components/founder/FounderComingSoon";
import { useTranslation } from "@/lib/i18n/LanguageContext";

export default function FounderSettingsPage() {
  const { t } = useTranslation();
  return (
    <FounderComingSoon
      icon={Settings}
      title={t("nav.settings")}
      description={t("founder.settingsComingSoonDescription")}
    />
  );
}

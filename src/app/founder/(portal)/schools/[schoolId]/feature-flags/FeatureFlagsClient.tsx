"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FEATURE_FLAG_GROUPS, FEATURE_FLAG_LABELS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";
import { useTranslation } from "@/lib/i18n/LanguageContext";

export default function FeatureFlagsClient({
  schoolId,
  initialFlags,
}: {
  schoolId: string;
  initialFlags: Record<FeatureFlagKeyValue, boolean>;
}) {
  const { t } = useTranslation();
  const [flags, setFlags] = useState(initialFlags);
  const [savingKey, setSavingKey] = useState<FeatureFlagKeyValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: FeatureFlagKeyValue, enabled: boolean) {
    setFlags((prev) => ({ ...prev, [key]: enabled }));
    setSavingKey(key);
    setError(null);

    try {
      const res = await fetch(`/api/founder/schools/${schoolId}/feature-flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (!res.ok) throw new Error(t("founder.requestFailed"));
    } catch {
      setFlags((prev) => ({ ...prev, [key]: !enabled }));
      setError(t("founder.couldntUpdateFeatureFlag", { flag: FEATURE_FLAG_LABELS[key] }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">{error}</div>
      )}
      {FEATURE_FLAG_GROUPS.map((group) => (
        <Card key={group.label} className="border-border">
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            {group.keys.map((key) => (
              <div key={key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span className="text-sm font-medium text-foreground">{FEATURE_FLAG_LABELS[key]}</span>
                <Switch
                  checked={flags[key]}
                  disabled={savingKey === key}
                  onCheckedChange={(checked) => toggle(key, checked)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

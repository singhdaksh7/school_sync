"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useParentAuth } from "@/lib/parent-web-auth";

export default function ParentLoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login } = useParentAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/parent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || t("parentLeave.loginFailed"));
        return;
      }
      login({ token: data.token, user: data.user });
      router.replace("/parent/leave");
    } catch {
      setError(t("parentLeave.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm border-border">
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}
            >
              <GraduationCap className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-foreground">{t("parentLeave.loginTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("parentLeave.loginSubtitle")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="parent-phone">{t("parentLeave.phone")}</Label>
              <Input id="parent-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent-password">{t("parentLeave.password")}</Label>
              <Input id="parent-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t("parentLeave.loggingIn") : t("parentLeave.login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

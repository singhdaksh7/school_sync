"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? t("auth.somethingWentWrong"));
        return;
      }
      setSubmitted(true);
    } catch {
      setError(t("auth.somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #2563eb, #0f172a)" }}
          >
            <Mail className="h-6 w-6" />
          </div>
          <span className="mt-3 text-2xl font-bold tracking-tight text-foreground">{t("auth.forgotPasswordTitle")}</span>
          <span className="mt-1 text-sm text-muted-foreground">{t("auth.forgotPasswordSubtitle")}</span>
        </div>
        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          {submitted ? (
            <CardContent className="space-y-4 pt-6">
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300">
                {t("auth.resetInstructionsSent")}
              </div>
              <a href="/login" className="block text-center text-sm font-medium text-muted-foreground underline hover:text-foreground">
                {t("auth.backToLogin")}
              </a>
            </CardContent>
          ) : (
            <form onSubmit={handleSubmit}>
              <CardHeader>
                <CardTitle className="text-xl">{t("auth.resetPasswordTitle")}</CardTitle>
                <CardDescription>{t("auth.enterAccountEmail")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t("common.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t("common.sending") : t("auth.sendResetLink")}
                </Button>
                <a href="/login" className="text-center text-sm font-medium text-muted-foreground underline hover:text-foreground">
                  {t("auth.backToLogin")}
                </a>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

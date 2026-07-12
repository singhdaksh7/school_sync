"use client";

import { useEffect, useState, Suspense } from "react";
import { signIn, signOut, getSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { ShieldCheck, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  if (!mounted) return <div className="h-9 w-9" />;

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={label}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function FounderLoginForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Clear any existing session first — otherwise a failed attempt here
      // would leave a previously-established session active, making it
      // look like the wrong password "worked" when it's really just stale
      // login state from before.
      const existing = await getSession();
      if (existing) await signOut({ redirect: false });

      // The dedicated founder-credentials provider rejects any non-FOUNDER
      // account server-side (src/lib/auth-web.ts) — a session is never
      // created for the wrong role, so there's nothing to double-check or
      // sign back out of here.
      const result = await signIn("founder-credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error) {
        // Deliberately the same message for every failure code (no account,
        // wrong password, not a Founder account) — the UI never reveals
        // which one occurred.
        setError(t("auth.invalidCredentialsShort"));
        return;
      }
      window.location.href = "/founder/dashboard";
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
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle label={t("common.toggleTheme")} />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
          >
            <ShieldCheck className="h-6 w-6" />
          </div>
          <span className="mt-3 text-2xl font-bold tracking-tight text-foreground">{t("auth.founderPortal")}</span>
          <span className="mt-1 text-sm text-muted-foreground">{t("auth.founderPortalSubtitle")}</span>
        </div>
        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <CardHeader>
            <CardTitle className="text-xl">{t("common.signIn")}</CardTitle>
            <CardDescription>{t("auth.founderRestricted")}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
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
                  placeholder="founder@schoolsync.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("common.password")}</Label>
                  <a href="/forgot-password" className="text-xs font-medium text-muted-foreground underline hover:text-foreground">
                    {t("common.forgotPassword")}
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("common.signingIn") : t("common.signIn")}
              </Button>
            </CardFooter>
          </form>
        </Card>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          {t("auth.notFounder")}{" "}
          <a href="/login" className="font-medium underline hover:text-foreground">
            {t("auth.goToSchoolLogin")}
          </a>
        </p>
      </div>
    </div>
  );
}

export default function FounderLoginPage() {
  return (
    <Suspense>
      <FounderLoginForm />
    </Suspense>
  );
}

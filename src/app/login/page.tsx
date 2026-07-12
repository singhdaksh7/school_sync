"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut, getSession } from "next-auth/react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { detectLoginIdentifierKind } from "@/lib/login-identifier";

type Branding = {
  schoolName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  appName: string;
  poweredBySchoolSync: boolean;
};

const DEFAULT_BRANDING: Branding = {
  schoolName: "SchoolSync",
  logoUrl: null,
  primaryColor: "#2563eb",
  secondaryColor: "#0f172a",
  appName: "SchoolSync",
  poweredBySchoolSync: false,
};

function LoginForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    let active = true;

    fetch("/api/branding", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Branding | null) => {
        if (active && data) setBranding(data);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

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

      // The identifier's *format* (not a role the user picked) decides which
      // provider verifies it server-side. Staff accounts are always email;
      // Student accounts are always an admission number, which never
      // contains "@". Both providers independently re-check the password and
      // resolve the account's real role from the database — nothing here is
      // trusted as an authorization signal.
      const kind = detectLoginIdentifierKind(form.identifier);
      const callbackUrl = `/api/auth/redirect?nonce=${Date.now()}`;
      const result =
        kind === "staff"
          ? await signIn("credentials", {
              email: form.identifier,
              password: form.password,
              redirect: false,
              callbackUrl,
            })
          : await signIn("student-credentials", {
              identifier: form.identifier,
              password: form.password,
              redirect: false,
              callbackUrl,
            });

      if (result?.error) {
        // Deliberately the same message for every failure code (no account,
        // wrong password, role mismatch) — the UI never reveals which one
        // occurred.
        setError(t("auth.invalidCredentials"));
        return;
      }
      window.location.href = callbackUrl;
    } catch {
      setError(t("auth.somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gradient-mesh relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20">
        <LanguageSwitcher />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" className="flex items-center gap-2.5">
            {branding.logoUrl ? (
              <div
                aria-label={`${branding.appName} logo`}
                className="h-12 w-12 rounded-2xl border border-border bg-white bg-contain bg-center bg-no-repeat shadow-sm"
                style={{ backgroundImage: `url("${branding.logoUrl}")` }}
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.primaryColor}b3)` }}
              >
                <GraduationCap className="h-6 w-6" />
              </div>
            )}
            <span className="text-2xl font-bold tracking-tight text-foreground">{branding.appName}</span>
          </Link>
        </div>
        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <CardHeader>
            <CardTitle className="text-xl">{t("auth.welcomeBack")}</CardTitle>
            <CardDescription>{t("auth.signInToAccount", { school: branding.schoolName })}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="identifier">{t("auth.identifier")}</Label>
                <Input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="john@school.edu"
                  value={form.identifier}
                  onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("common.password")}</Label>
                  <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground underline hover:text-foreground">
                    {t("common.forgotPassword")}
                  </Link>
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
            <CardFooter className="flex-col gap-3">
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                style={{ backgroundColor: branding.primaryColor }}
              >
                {loading ? t("common.signingIn") : t("common.signIn")}
              </Button>
            </CardFooter>
          </form>
        </Card>
        {branding.poweredBySchoolSync && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            {t("common.poweredBy")} <span className="font-semibold text-foreground">SchoolSync</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { saveGuardianSession } from "@/lib/guardian-auth-client";

/**
 * Dedicated Guardian login page — NOT folded into the unified staff/student
 * /login page. That page routes both roles through NextAuth credential
 * providers keyed off identifier format (email vs admission number); parent
 * accounts are a genuinely different, non-NextAuth JWT scheme
 * (POST /api/parent/login -> generateParentToken, see src/lib/parent-auth.ts)
 * so it needs its own phone+password form posting straight to that endpoint.
 * The web portal's session lives in an httpOnly cookie the server sets on
 * this response, not in anything client JS can read directly.
 */
export default function GuardianLoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Can't read the httpOnly cookie from JS, so ask the server whether one
    // is already valid instead of skipping straight past login.
    let active = true;
    fetch("/api/parent/children", { credentials: "include" })
      .then((res) => { if (active && res.ok) router.replace("/guardian/dashboard"); })
      .catch(() => {});
    return () => { active = false; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/parent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || t("guardian.invalidCredentials"));
        return;
      }
      saveGuardianSession(data.user);
      router.push("/guardian/dashboard");
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
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}
            >
              <GraduationCap className="h-6 w-6" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-foreground">SchoolSync</span>
          </Link>
        </div>
        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <CardHeader>
            <CardTitle className="text-xl">{t("guardian.loginTitle")}</CardTitle>
            <CardDescription>{t("guardian.loginSubtitle")}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("common.phone")}</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("common.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("common.signingIn") : t("common.signIn")}
              </Button>
            </CardFooter>
          </form>
        </Card>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          {t("common.poweredBy")} <span className="font-semibold text-foreground">SchoolSync</span>
        </p>
      </div>
    </div>
  );
}

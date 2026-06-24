"use client";

import { useState, Suspense } from "react";
import { signIn, signOut, getSession } from "next-auth/react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

function StudentLoginForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ admissionNo: "", password: "" });
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

      const result = await signIn("student-credentials", {
        identifier: form.admissionNo,
        password: form.password,
        redirect: false,
      });

      if (result?.error) {
        if (result.code === "no-account") setError(t("auth.noAccountWithAdmissionNo"));
        else if (result.code === "invalid-password") setError(t("auth.incorrectPassword"));
        else setError(t("auth.invalidCredentialsShort"));
        return;
      }

      window.location.href = "/student/dashboard";
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
            style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}
          >
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="mt-3 text-2xl font-bold tracking-tight text-foreground">{t("auth.studentPortal")}</span>
          <span className="mt-1 text-sm text-muted-foreground">{t("auth.studentPortalSubtitle")}</span>
        </div>
        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <CardHeader>
            <CardTitle className="text-xl">{t("common.signIn")}</CardTitle>
            <CardDescription>{t("auth.studentSignInDesc")}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="admissionNo">{t("auth.admissionNumber")}</Label>
                <Input
                  id="admissionNo"
                  type="text"
                  autoComplete="username"
                  placeholder="e.g. ADM-001"
                  value={form.admissionNo}
                  onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
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
          {t("auth.notAStudent")}{" "}
          <a href="/login" className="font-medium underline hover:text-foreground">
            {t("auth.goToStaffLogin")}
          </a>
        </p>
      </div>
    </div>
  );
}

export default function StudentLoginPage() {
  return (
    <Suspense>
      <StudentLoginForm />
    </Suspense>
  );
}

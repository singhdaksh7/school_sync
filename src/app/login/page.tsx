"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

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
  const params = useSearchParams();
  const registered = params.get("registered");
  const [form, setForm] = useState({ email: "", password: "" });
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
      const callbackUrl = `/api/auth/redirect?nonce=${Date.now()}`;
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
        callbackUrl,
      });
      if (!result?.ok) {
        setError("Invalid credentials or this account is not allowed for this school.");
        return;
      }
      window.location.href = callbackUrl;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2">
            {branding.logoUrl ? (
              <div
                aria-label={`${branding.appName} logo`}
                className="w-10 h-10 rounded-lg bg-white border border-gray-200 bg-center bg-contain bg-no-repeat"
                style={{ backgroundImage: `url("${branding.logoUrl}")` }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: branding.primaryColor }}
              >
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
            )}
            <span className="text-xl font-bold text-gray-900">{branding.appName}</span>
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Sign in to your {branding.schoolName} account</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {registered && (
                <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-md border border-green-200">
                  Account created! Please sign in.
                </div>
              )}
              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@school.edu"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
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
                {loading ? "Signing in..." : "Sign in"}
              </Button>
              <p className="text-sm text-gray-500 text-center">
                Don&apos;t have an account?{" "}
                <Link
                  href="/register"
                  className="hover:underline font-medium"
                  style={{ color: branding.primaryColor }}
                >
                  Create one free
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
        {branding.poweredBySchoolSync && (
          <p className="mt-5 text-center text-xs text-gray-500">
            Powered by <span className="font-semibold text-gray-700">SchoolSync</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

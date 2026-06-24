"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_LABELS: Record<string, string> = {
  SCHOOL_ADMIN: "Admin",
  VICE_PRINCIPAL: "Vice Principal",
  TEACHER: "Teacher",
};

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;

  const [invite, setInvite] = useState<{ name: string | null; email: string; role: string; school: { name: string; slug: string } } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [contact, setContact] = useState<{ name: string; email: string } | null>(null);
  const [form, setForm] = useState({ name: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setInviteError(d.error); setContact(d.contact ?? null); }
        else { setInvite(d); setForm((prev) => ({ ...prev, name: d.name || prev.name })); }
      });
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    const res = await fetch(`/api/invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setLoading(false); return; }

    const callbackUrl = `/api/auth/redirect?nonce=${Date.now()}`;
    const signInResult = await signIn("credentials", {
      email: invite!.email,
      password: form.password,
      redirect: false,
      callbackUrl,
    });

    if (!signInResult?.ok) {
      setError("Account created, but sign in failed. Please log in manually.");
      setLoading(false);
      return;
    }

    window.location.href = callbackUrl;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SchoolSync</span>
          </div>
        </div>

        {inviteError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-red-600 font-medium">{inviteError}</p>
              {contact ? (
                <a
                  href={`mailto:${contact.email}?subject=${encodeURIComponent("Requesting a new SchoolSync invite")}`}
                  className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Request New Invitation
                </a>
              ) : (
                <p className="text-gray-400 text-sm mt-2">Please contact your school administrator for a new invite.</p>
              )}
            </CardContent>
          </Card>
        ) : !invite ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-400">Loading...</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>You&apos;re invited!</CardTitle>
              <CardDescription>
                You&apos;ve been invited to manage <strong>{invite.school.name}</strong> on SchoolSync.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleAccept}>
              <CardContent className="space-y-4">
                {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">{error}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input value={invite.email} disabled className="bg-gray-50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input value={ROLE_LABELS[invite.role] || invite.role} disabled className="bg-gray-50" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Your Name</Label>
                  <Input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Create Password</Label>
                  <Input type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirm Password</Label>
                  <Input type="password" placeholder="Re-enter password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required minLength={6} />
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p className="text-xs text-red-600">Passwords do not match</p>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Joining..." : "Accept Invite & Join"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

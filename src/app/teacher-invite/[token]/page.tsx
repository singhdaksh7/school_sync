"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";

interface InviteData { email: string; name: string; school: string }

export default function TeacherInvitePage() {
  const params = useParams();
  const token = params.token as string;

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/teacher-invite/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setInviteError(d.error);
        else setInvite(d);
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setError("");
    setLoading(true);

    const res = await fetch(`/api/teacher-invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setLoading(false); return; }

    // Auto sign in
    const signInResult = await signIn("credentials", {
      email: invite!.email,
      password,
      redirect: false,
      callbackUrl: "/api/auth/redirect",
    });

    if (!signInResult?.ok) {
      setError("Password set, but sign in failed. Please log in manually.");
      setLoading(false);
      return;
    }

    window.location.href = signInResult.url ?? "/api/auth/redirect";
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
              <p className="text-gray-400 text-sm mt-2">Please contact your school admin for a new link.</p>
            </CardContent>
          </Card>
        ) : !invite ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-400">Loading...</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Set your password</CardTitle>
              <CardDescription>
                Welcome, <strong>{invite.name}</strong>! You have been added as a teacher at{" "}
                <strong>{invite.school}</strong>. Create a password to access your portal.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={invite.email} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label>Create Password</Label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    placeholder="Repeat your password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Setting up..." : "Set Password & Sign In"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

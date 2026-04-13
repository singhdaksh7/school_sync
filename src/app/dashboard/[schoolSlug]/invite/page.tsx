"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { UserPlus, Copy, Check, Mail, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Invite { id: string; email: string; usedAt: string | null; expiresAt: string; createdAt: string; inviteLink?: string }

export default function InvitePage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [newInviteLink, setNewInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetchInvites(d.id);
    });
  }, [schoolSlug]);

  async function fetchInvites(sid: string) {
    const res = await fetch(`/api/schools/${sid}/invites`);
    setInvites(await res.json());
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setError(""); setNewInviteLink("");
    const res = await fetch(`/api/schools/${schoolId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSending(false); return; }
    setNewInviteLink(data.inviteLink);
    setEmail("");
    fetchInvites(schoolId);
    setSending(false);
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Invite Admins</h2>
        <p className="text-sm text-gray-500 mt-1">Invite team members to help manage your school</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send Invite</CardTitle>
          <CardDescription>The person will get a link to create their admin account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendInvite} className="space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <div className="flex gap-2">
                <Input type="email" placeholder="admin@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} required className="flex-1" />
                <Button type="submit" disabled={sending} className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  {sending ? "Sending..." : "Send Invite"}
                </Button>
              </div>
            </div>
            {newInviteLink && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 mb-2">Invite link created! Share this link:</p>
                <div className="flex gap-2">
                  <Input value={newInviteLink} readOnly className="flex-1 text-xs bg-white" />
                  <Button type="button" variant="outline" size="sm" onClick={() => copyLink(newInviteLink)} className="gap-1.5 shrink-0">
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-green-600 mt-2">Link expires in 7 days</p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sent Invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No invites sent yet</p>
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <div key={inv.id} className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <Mail className="w-4 h-4 text-gray-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Sent {formatDate(inv.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={inv.usedAt ? "success" : expired ? "destructive" : "secondary"}>
                      {inv.usedAt ? "Accepted" : expired ? "Expired" : "Pending"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

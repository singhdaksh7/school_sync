"use client";

import { useState } from "react";
import { UserPlus, Copy, Check, Mail, Clock, ShieldCheck, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

interface Invite {
  id: string; email: string; role: string; usedAt: string | null; expiresAt: string; createdAt: string;
}

const ROLE_OPTIONS = [
  { value: "SCHOOL_ADMIN", label: "Admin", description: "Can manage teachers, students, classes, attendance", icon: ShieldCheck },
  { value: "VICE_PRINCIPAL", label: "Vice Principal", description: "Read-only access to all data, reports, and attendance", icon: GraduationCap },
];

const ROLE_COLORS: Record<string, string> = {
  SCHOOL_ADMIN: "bg-purple-100 text-purple-700",
  VICE_PRINCIPAL: "bg-green-100 text-green-700",
};

interface Props { initialInvites: Invite[]; schoolId: string }

export default function InviteClient({ initialInvites, schoolId }: Props) {
  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("SCHOOL_ADMIN");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [newInviteLink, setNewInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function fetchInvites() {
    const res = await fetch(`/api/schools/${schoolId}/invites`);
    setInvites(await res.json());
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setError(""); setNewInviteLink("");
    const res = await fetch(`/api/schools/${schoolId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSending(false); return; }
    setNewInviteLink(data.inviteLink);
    setEmail("");
    fetchInvites();
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
        <h2 className="text-2xl font-bold text-gray-900">Invite Staff</h2>
        <p className="text-sm text-gray-500 mt-1">Invite admins or vice principals to access the school dashboard</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {ROLE_OPTIONS.map((r) => (
          <div
            key={r.value}
            onClick={() => setRole(r.value)}
            className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${
              role === r.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <r.icon className={`w-4 h-4 ${role === r.value ? "text-blue-600" : "text-gray-400"}`} />
              <p className={`text-sm font-semibold ${role === r.value ? "text-blue-700" : "text-gray-700"}`}>{r.label}</p>
            </div>
            <p className="text-xs text-gray-500">{r.description}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send Invite Link</CardTitle>
          <CardDescription>The person will get a link to create their account with the selected role</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendInvite} className="space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="staff@school.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="flex-1"
                />
                <Button type="submit" disabled={sending} className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  {sending ? "Creating..." : "Create Link"}
                </Button>
              </div>
            </div>
            {newInviteLink && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 mb-2">Invite link created! Share this:</p>
                <div className="flex gap-2">
                  <Input value={newInviteLink} readOnly className="flex-1 text-xs bg-white font-mono" />
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
        <CardHeader><CardTitle className="text-base">Sent Invites</CardTitle></CardHeader>
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
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[inv.role] || "bg-gray-100 text-gray-600"}`}>
                            {inv.role === "SCHOOL_ADMIN" ? "Admin" : "Vice Principal"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Sent {formatDate(inv.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={inv.usedAt ? "default" : expired ? "destructive" : "secondary"}>
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

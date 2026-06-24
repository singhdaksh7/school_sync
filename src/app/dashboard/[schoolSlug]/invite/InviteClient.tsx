"use client";

import { useState } from "react";
import { UserPlus, Copy, Check, Mail, Clock, ShieldCheck, GraduationCap, BookOpenCheck, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

interface Invite {
  id: string; name: string | null; email: string; role: string; usedAt: string | null; expiresAt: string; createdAt: string;
  invitedBy?: { name: string } | null;
}

const ALL_ROLE_OPTIONS = [
  { value: "SCHOOL_ADMIN", label: "Admin", description: "Can manage teachers, students, classes, attendance", icon: ShieldCheck, ownerOnly: true },
  { value: "VICE_PRINCIPAL", label: "Vice Principal", description: "Read-only access to all data, reports, and attendance", icon: GraduationCap, ownerOnly: false },
  { value: "TEACHER", label: "Teacher", description: "Marks attendance, homework, and exam results for their classes", icon: BookOpenCheck, ownerOnly: false },
];

const ROLE_COLORS: Record<string, string> = {
  SCHOOL_ADMIN: "bg-purple-100 text-purple-700",
  VICE_PRINCIPAL: "bg-green-100 text-green-700",
  TEACHER: "bg-blue-100 text-blue-700",
};

const ROLE_LABELS: Record<string, string> = {
  SCHOOL_ADMIN: "Admin",
  VICE_PRINCIPAL: "Vice Principal",
  TEACHER: "Teacher",
};

interface Props { initialInvites: Invite[]; schoolId: string; callerRole?: string }

export default function InviteClient({ initialInvites, schoolId, callerRole }: Props) {
  const roleOptions = ALL_ROLE_OPTIONS.filter((r) => !r.ownerOnly || callerRole === "SCHOOL_OWNER");

  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roleOptions[0]?.value ?? "VICE_PRINCIPAL");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newInviteLink, setNewInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  async function fetchInvites() {
    const res = await fetch(`/api/schools/${schoolId}/invites`);
    if (res.ok) setInvites(await res.json());
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setError(""); setNotice(""); setNewInviteLink("");
    const res = await fetch(`/api/schools/${schoolId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSending(false); return; }
    setNewInviteLink(data.inviteLink);
    if (data.emailError) setNotice(data.emailError);
    setName(""); setEmail("");
    fetchInvites();
    setSending(false);
  }

  async function resendInvite(id: string) {
    setActioningId(id); setError(""); setNotice("");
    const res = await fetch(`/api/schools/${schoolId}/invites/${id}`, { method: "PATCH" });
    const data = await res.json();
    setActioningId(null);
    if (!res.ok) { setError(data.error); return; }
    setNotice(data.emailError || "Invite resent.");
    fetchInvites();
  }

  async function cancelInvite(id: string) {
    if (!confirm("Cancel this invitation? The link will stop working immediately.")) return;
    setActioningId(id); setError(""); setNotice("");
    const res = await fetch(`/api/schools/${schoolId}/invites/${id}`, { method: "DELETE" });
    setActioningId(null);
    if (!res.ok) { const data = await res.json(); setError(data.error); return; }
    setInvites((prev) => prev.filter((inv) => inv.id !== id));
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
        <p className="text-sm text-gray-500 mt-1">Invite admins, vice principals, or teachers to access the school dashboard</p>
      </div>

      <div className={`grid gap-3 ${roleOptions.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {roleOptions.map((r) => (
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
          <CardTitle className="text-base">Send Invite</CardTitle>
          <CardDescription>They&apos;ll receive an email with a link to create their account with the selected role</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendInvite} className="space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            {notice && <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">{notice}</p>}
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} required />
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
                  {sending ? "Sending..." : "Send Invite"}
                </Button>
              </div>
            </div>
            {newInviteLink && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 mb-2">Invite sent! Link (in case the email doesn&apos;t arrive):</p>
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
        <CardHeader><CardTitle className="text-base">Pending Invitations</CardTitle></CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No invites sent yet</p>
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                const status = inv.usedAt ? "Accepted" : expired ? "Expired" : "Pending";
                return (
                  <div key={inv.id} className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">{inv.name || inv.email}</p>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${ROLE_COLORS[inv.role] || "bg-gray-100 text-gray-600"}`}>
                            {ROLE_LABELS[inv.role] || inv.role}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{inv.email}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Sent {formatDate(inv.createdAt)}
                          {inv.invitedBy?.name && <span> &middot; by {inv.invitedBy.name}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={inv.usedAt ? "default" : expired ? "destructive" : "secondary"}>{status}</Badge>
                      {status !== "Accepted" && (
                        <>
                          <Button
                            type="button" variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600"
                            title="Resend invite" disabled={actioningId === inv.id}
                            onClick={() => resendInvite(inv.id)}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button" variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600"
                            title="Cancel invite" disabled={actioningId === inv.id}
                            onClick={() => cancelInvite(inv.id)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
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

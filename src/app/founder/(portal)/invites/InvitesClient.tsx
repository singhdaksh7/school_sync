"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, RotateCcw, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import InviteAdminClient from "./InviteAdminClient";

type Invite = {
  id: string;
  name: string | null;
  email: string;
  usedAt: string | Date | null;
  expiresAt: string | Date;
  createdAt: string | Date;
  school: { id: string; name: string; slug: string };
  plan: { id: string; name: string } | null;
};

function inviteStatus(invite: Invite): "Accepted" | "Expired" | "Pending" {
  if (invite.usedAt) return "Accepted";
  if (new Date(invite.expiresAt) < new Date()) return "Expired";
  return "Pending";
}

export default function InvitesClient({ initialInvites }: { initialInvites: Invite[] }) {
  const router = useRouter();
  const [invites, setInvites] = useState(initialInvites);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function resend(id: string) {
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/founder/invites/${id}`, { method: "PATCH" });
    setBusyId(null);
    if (!res.ok) { setError("Could not resend the invite."); return; }
    router.refresh();
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this invite?")) return;
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/founder/invites/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) { setError("Could not cancel the invite."); return; }
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">School Admin Invites</h2>
          <p className="mt-1 text-sm text-muted-foreground">Invite admins to schools. No account exists until they accept.</p>
        </div>
        <InviteAdminClient />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="border-border">
        <CardHeader><CardTitle className="text-base">All Invites ({invites.length})</CardTitle></CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <Mail className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No invites yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Admin</th>
                    <th className="pb-2 pr-4 font-medium">School</th>
                    <th className="pb-2 pr-4 font-medium">Plan</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Sent</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => {
                    const status = inviteStatus(invite);
                    return (
                      <tr key={invite.id} className="border-b border-border/60 last:border-0">
                        <td className="py-3 pr-4">
                          <p className="font-medium text-foreground">{invite.name || invite.email}</p>
                          <p className="text-xs text-muted-foreground">{invite.email}</p>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{invite.school.name}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{invite.plan?.name ?? "—"}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={status === "Accepted" ? "default" : status === "Expired" ? "destructive" : "secondary"}>
                            {status}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatDate(invite.createdAt)}</td>
                        <td className="py-3 text-right">
                          {status !== "Accepted" && (
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" className="gap-1.5" disabled={busyId === invite.id} onClick={() => resend(invite.id)}>
                                <RotateCcw className="h-3.5 w-3.5" /> Resend
                              </Button>
                              <Button variant="outline" size="sm" className="gap-1.5 text-destructive" disabled={busyId === invite.id} onClick={() => cancel(invite.id)}>
                                <X className="h-3.5 w-3.5" /> Cancel
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

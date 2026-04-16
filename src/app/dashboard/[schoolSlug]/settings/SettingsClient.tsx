"use client";

import { useState } from "react";
import { Save, Building2, Phone, Mail, Globe, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SchoolData {
  id: string; name: string; address: string | null; phone: string | null;
  email: string | null; website: string | null; slug: string;
  admins: { id: string; name: string; email: string }[];
}

interface Props { initialSchool: SchoolData }

export default function SettingsClient({ initialSchool }: Props) {
  const [school] = useState<SchoolData>(initialSchool);
  const [form, setForm] = useState({
    name: initialSchool.name,
    address: initialSchool.address || "",
    phone: initialSchool.phone || "",
    email: initialSchool.email || "",
    website: initialSchool.website || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    const res = await fetch(`/api/schools/${school.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000); setSaving(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Manage your school&apos;s profile and information</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">School Information</CardTitle>
          <CardDescription>Update your school&apos;s basic details</CardDescription>
        </CardHeader>
        <form onSubmit={handleSave}>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            {saved && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">Settings saved successfully!</p>}
            <div className="space-y-1.5">
              <Label>School Name *</Label>
              <div className="relative"><Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-9" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <div className="relative"><MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-9" placeholder="School address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-9" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>School Email</Label>
                <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-9" type="email" placeholder="info@school.edu" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <div className="relative"><Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-9" placeholder="https://school.edu" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>School URL</Label>
              <Input value={`/dashboard/${school.slug}`} disabled className="bg-gray-50 text-gray-500 text-sm" />
              <p className="text-xs text-gray-400">Your school&apos;s unique URL — cannot be changed</p>
            </div>
            <Button type="submit" className="gap-2" disabled={saving}>
              <Save className="w-4 h-4" />{saving ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </form>
      </Card>

      {school.admins.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Admin Members</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {school.admins.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-sm font-semibold">{a.name[0]}</div>
                    <div><p className="text-sm font-medium text-gray-900">{a.name}</p><p className="text-xs text-gray-400">{a.email}</p></div>
                  </div>
                  <Badge variant="secondary">Admin</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

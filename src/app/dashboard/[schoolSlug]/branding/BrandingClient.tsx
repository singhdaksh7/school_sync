"use client";

import { useState } from "react";
import { Globe, ImageIcon, Paintbrush, Save, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BrandingData {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  appName: string | null;
  poweredBySchoolSync: boolean;
}

interface Props {
  initialBranding: BrandingData;
}

const DEFAULT_PRIMARY = "#2563eb";
const DEFAULT_SECONDARY = "#0f172a";

export default function BrandingClient({ initialBranding }: Props) {
  const [branding, setBranding] = useState(initialBranding);
  const [form, setForm] = useState({
    customDomain: initialBranding.customDomain || "",
    logoUrl: initialBranding.logoUrl || "",
    primaryColor: initialBranding.primaryColor || DEFAULT_PRIMARY,
    secondaryColor: initialBranding.secondaryColor || DEFAULT_SECONDARY,
    appName: initialBranding.appName || "",
    poweredBySchoolSync: initialBranding.poweredBySchoolSync,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function saveBranding(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");

    const res = await fetch(`/api/schools/${branding.id}/branding`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Could not save branding.");
      return;
    }

    setBranding(data);
    setForm({
      customDomain: data.customDomain || "",
      logoUrl: data.logoUrl || "",
      primaryColor: data.primaryColor || DEFAULT_PRIMARY,
      secondaryColor: data.secondaryColor || DEFAULT_SECONDARY,
      appName: data.appName || "",
      poweredBySchoolSync: data.poweredBySchoolSync,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  const previewName = form.appName.trim() || branding.name;
  const primaryColor = form.primaryColor || DEFAULT_PRIMARY;
  const secondaryColor = form.secondaryColor || DEFAULT_SECONDARY;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Branding</h2>
        <p className="text-sm text-gray-500 mt-1">Configure white-label identity and custom domain for this school.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-blue-600" /> White-label Settings
            </CardTitle>
            <CardDescription>These settings are public branding fields only. Tenant access still uses school IDs.</CardDescription>
          </CardHeader>
          <form onSubmit={saveBranding}>
            <CardContent className="space-y-4">
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
              {saved && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">Branding saved successfully.</p>}

              <div className="space-y-1.5">
                <Label>Custom Domain</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9"
                    placeholder="erp.schooldomain.com"
                    value={form.customDomain}
                    onChange={(event) => setForm((prev) => ({ ...prev, customDomain: event.target.value }))}
                  />
                </div>
                <p className="text-xs text-gray-400">Add a CNAME to your SchoolSync deployment, then save the exact host here.</p>
              </div>

              <div className="space-y-1.5">
                <Label>Logo URL</Label>
                <div className="relative">
                  <ImageIcon aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9"
                    placeholder="https://school.edu/logo.png"
                    value={form.logoUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, logoUrl: event.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      className="w-14 px-1"
                      value={primaryColor}
                      onChange={(event) => setForm((prev) => ({ ...prev, primaryColor: event.target.value }))}
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={(event) => setForm((prev) => ({ ...prev, primaryColor: event.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      className="w-14 px-1"
                      value={secondaryColor}
                      onChange={(event) => setForm((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                    />
                    <Input
                      value={form.secondaryColor}
                      onChange={(event) => setForm((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>App Name</Label>
                <Input
                  placeholder={branding.name}
                  value={form.appName}
                  onChange={(event) => setForm((prev) => ({ ...prev, appName: event.target.value }))}
                />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.poweredBySchoolSync}
                  onChange={(event) => setForm((prev) => ({ ...prev, poweredBySchoolSync: event.target.checked }))}
                />
                <span>
                  <span className="font-medium text-gray-900">Show Powered by SchoolSync</span>
                  <span className="block text-xs text-gray-500 mt-0.5">Recommended while schools are using the hosted SchoolSync platform.</span>
                </span>
              </label>

              <Button type="submit" disabled={saving} className="gap-2">
                <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Branding"}
              </Button>
            </CardContent>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>Public response from `/api/branding` for this school.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="h-3" style={{ backgroundColor: primaryColor }} />
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {form.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.logoUrl} alt="" className="w-11 h-11 rounded-lg object-cover border border-gray-100" />
                  ) : (
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: primaryColor }}>
                      {previewName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{previewName}</p>
                    <p className="text-xs" style={{ color: secondaryColor }}>{branding.name}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{form.customDomain || `${branding.slug}.schoolsync.in`}</Badge>
                  {form.poweredBySchoolSync && <Badge variant="outline">Powered by SchoolSync</Badge>}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-3 text-sm text-blue-800">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5" />
                <p>Branding is public. Admin, teacher, parent, fees, homework, and attendance data still require authenticated school-scoped APIs.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Globe, ImageIcon, Paintbrush, Save, ShieldCheck, Copy, Check, Trash2, Loader2, AlertCircle } from "lucide-react";
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

/** Matches the `serialize()` shape returned by /api/schools/[schoolId]/custom-domain (GET/POST). */
interface CustomDomainConfig {
  id: string;
  hostname: string;
  status: "PENDING" | "VERIFYING" | "VERIFIED" | "FAILED" | "DISABLED";
  verificationMethod: string;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  dnsRecord: { type: string; name: string; value: string } | null;
}

const DEFAULT_PRIMARY = "#2563eb";
const DEFAULT_SECONDARY = "#0f172a";

export default function BrandingClient({ initialBranding }: Props) {
  const [branding, setBranding] = useState(initialBranding);
  const [form, setForm] = useState({
    logoUrl: initialBranding.logoUrl || "",
    primaryColor: initialBranding.primaryColor || DEFAULT_PRIMARY,
    secondaryColor: initialBranding.secondaryColor || DEFAULT_SECONDARY,
    appName: initialBranding.appName || "",
    poweredBySchoolSync: initialBranding.poweredBySchoolSync,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Logo file state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState("");

  // Domain states
  const [domainConfig, setDomainConfig] = useState<CustomDomainConfig | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newHostname, setNewHostname] = useState("");
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [disablingDomain, setDisablingDomain] = useState(false);
  const [domainError, setDomainError] = useState("");
  const [copiedText, setCopiedText] = useState("");

  useEffect(() => {
    fetchCustomDomain();
  }, [branding.id]);

  const fetchCustomDomain = async () => {
    setDomainLoading(true);
    try {
      const res = await fetch(`/api/schools/${branding.id}/custom-domain`);
      const data = await res.json();
      setDomainConfig(data.domain || null);
    } catch (e) {
      console.error(e);
    } finally {
      setDomainLoading(false);
    }
  };

  const addDomain = async () => {
    if (!newHostname) return;
    setAddingDomain(true);
    setDomainError("");
    try {
      const res = await fetch(`/api/schools/${branding.id}/custom-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: newHostname }),
      });
      const data = await res.json();
      if (res.ok) {
        setDomainConfig(data.domain);
        setNewHostname("");
      } else {
        setDomainError(data.error || "Failed to configure custom domain.");
      }
    } catch (e) {
      setDomainError("Network request failed.");
    } finally {
      setAddingDomain(false);
    }
  };

  const verifyDomain = async () => {
    if (!domainConfig) return;
    setVerifyingDomain(true);
    setDomainError("");
    try {
      const res = await fetch(`/api/schools/${branding.id}/custom-domain/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: domainConfig.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setDomainConfig(data.domain);
        if (data.verified) {
          alert("DNS Ownership Verified successfully!");
        } else {
          alert("DNS verification failed. Please ensure the TXT record has propagated.");
        }
      } else {
        setDomainError(data.error || "Failed to trigger domain verification.");
      }
    } catch (e) {
      setDomainError("Network request failed.");
    } finally {
      setVerifyingDomain(false);
    }
  };

  const disableDomain = async () => {
    if (!domainConfig) return;
    if (!confirm("Disable custom domain and revert to schoolSlug subdomain access?")) return;
    setDisablingDomain(true);
    setDomainError("");
    try {
      const res = await fetch(`/api/schools/${branding.id}/custom-domain`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: domainConfig.id }),
      });
      if (res.ok) {
        setDomainConfig(null);
      } else {
        const data = await res.json();
        setDomainError(data.error || "Failed to disable custom domain.");
      }
    } catch (e) {
      setDomainError("Network request failed.");
    } finally {
      setDisablingDomain(false);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file && file.size > 2000000) {
      setLogoUploadError("File is too large (max 2MB)");
      setLogoFile(null);
      return;
    }
    setLogoUploadError("");
    setLogoFile(file);
  };

  const handleLogoUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logoFile) return;
    setUploadingLogo(true);
    setLogoUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", logoFile);
      const res = await fetch(`/api/schools/${branding.id}/branding/logo`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setForm((prev) => ({ ...prev, logoUrl: data.file.url }));
        setLogoFile(null);
        alert("Branding logo uploaded successfully!");
      } else {
        if (data.code === "UPLOAD_QUOTA_EXCEEDED") {
          setLogoUploadError("Upload quota exceeded. Please wait or upgrade your SchoolSync subscription.");
        } else {
          setLogoUploadError(data.error || "Failed to upload branding logo.");
        }
      }
    } catch (e) {
      setLogoUploadError("Network request failed.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(""), 2000);
  };

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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Branding</h2>
        <p className="text-sm text-gray-500 mt-1">Configure white-label identity and custom domain for this school.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* White-Label Settings Card */}
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

                {/* Managed Logo Upload Block */}
                <div className="space-y-2 border-b pb-4">
                  <Label>School Branding Logo</Label>
                  <div className="flex items-center gap-3 mt-1">
                    {form.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.logoUrl} alt="Logo" className="w-12 h-12 object-contain border rounded-lg bg-gray-50" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-dashed flex items-center justify-center text-gray-400 bg-gray-50">
                        <ImageIcon className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 space-y-1">
                      <Input type="file" accept="image/*" onChange={handleLogoFileChange} className="h-9 text-xs" />
                      <p className="text-[10px] text-gray-400">Accepted formats: PNG, JPG, WebP. Max size: 2MB.</p>
                    </div>
                    {logoFile && (
                      <Button size="sm" onClick={handleLogoUploadSubmit} disabled={uploadingLogo}>
                        {uploadingLogo ? "Uploading..." : "Upload logo"}
                      </Button>
                    )}
                  </div>
                  {logoUploadError && <p className="text-xs text-red-600 mt-1 font-medium">{logoUploadError}</p>}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Primary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        className="w-14 px-1 h-9"
                        value={primaryColor}
                        onChange={(event) => setForm((prev) => ({ ...prev, primaryColor: event.target.value }))}
                      />
                      <Input
                        className="h-9"
                        value={form.primaryColor || ""}
                        onChange={(event) => setForm((prev) => ({ ...prev, primaryColor: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Secondary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        className="w-14 px-1 h-9"
                        value={secondaryColor}
                        onChange={(event) => setForm((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                      />
                      <Input
                        className="h-9"
                        value={form.secondaryColor || ""}
                        onChange={(event) => setForm((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>App Name</Label>
                  <Input
                    placeholder={branding.name}
                    value={form.appName || ""}
                    onChange={(event) => setForm((prev) => ({ ...prev, appName: event.target.value }))}
                  />
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm cursor-pointer">
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
                  <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Branding Colors"}
                </Button>
              </CardContent>
            </form>
          </Card>

          {/* Custom Domain Management Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" /> Custom Domain Configuration
              </CardTitle>
              <CardDescription>
                Map a branded domain for your SchoolSync login portal and dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {domainError && <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg">{domainError}</p>}

              {domainLoading ? (
                <div className="py-6 text-center text-gray-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> Loading custom domain configuration...
                </div>
              ) : !domainConfig ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Configure New Hostname</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. erp.my-school.edu"
                        value={newHostname}
                        onChange={(e) => setNewHostname(e.target.value)}
                      />
                      <Button onClick={addDomain} disabled={addingDomain || !newHostname}>
                        {addingDomain ? "Configuring..." : "Add Domain"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Enter your school&apos;s custom hostname below. You&apos;ll then verify ownership using a DNS TXT record — no CNAME record is required for verification.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div>
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Hostname</p>
                      <p className="text-sm font-bold text-gray-900 mt-0.5">{domainConfig.hostname}</p>
                    </div>
                    <div>
                      <Badge variant={domainConfig.status === "VERIFIED" ? "success" : "warning"} className="text-[10px] px-2 py-0.5">
                        {domainConfig.status === "VERIFIED" ? "Ownership Verified" : domainConfig.status}
                      </Badge>
                    </div>
                  </div>

                  {domainConfig.status !== "VERIFIED" && domainConfig.dnsRecord && (() => {
                    const dnsRecord = domainConfig.dnsRecord;
                    return (
                    <div className="p-3 border border-amber-200 bg-amber-50/20 rounded-xl space-y-3">
                      <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" /> Action Required: Add DNS TXT Record
                      </p>

                      <div className="space-y-2 text-xs">
                        <div>
                          <Label className="text-[10px] uppercase text-gray-400 font-bold">TXT Name / Host</Label>
                          <div className="flex gap-1.5 items-center mt-0.5">
                            <code className="bg-white border rounded px-1.5 py-0.5 flex-1 select-all font-mono text-[10px] leading-tight">{dnsRecord.name}</code>
                            <Button size="icon" variant="ghost" className="w-6 h-6 shrink-0" onClick={() => copyToClipboard(dnsRecord.name, "host")}>
                              {copiedText === "host" ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase text-gray-400 font-bold">TXT Value</Label>
                          <div className="flex gap-1.5 items-center mt-0.5">
                            <code className="bg-white border rounded px-1.5 py-0.5 flex-1 select-all font-mono text-[10px] leading-tight">{dnsRecord.value}</code>
                            <Button size="icon" variant="ghost" className="w-6 h-6 shrink-0" onClick={() => copyToClipboard(dnsRecord.value, "value")}>
                              {copiedText === "value" ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end pt-1">
                        <Button variant="outline" size="sm" onClick={disableDomain} disabled={disablingDomain} className="text-red-600 hover:text-red-700 h-8">
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Disable
                        </Button>
                        <Button size="sm" onClick={verifyDomain} disabled={verifyingDomain} className="h-8">
                          {verifyingDomain ? "Verifying..." : "Verify DNS Ownership"}
                        </Button>
                      </div>
                    </div>
                    );
                  })()}

                  {domainConfig.status === "VERIFIED" && (
                    <div className="flex justify-between items-center bg-green-50/50 border border-green-250 p-3 rounded-xl">
                      <p className="text-xs text-green-800">
                        Domain ownership verified. SchoolSync does not automatically provision DNS routing or TLS — complete that setup with your hosting/CDN provider separately.
                      </p>
                      <Button variant="outline" size="sm" onClick={disableDomain} disabled={disablingDomain} className="text-red-600 hover:text-red-700 shrink-0 h-8">
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Revert
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview Panel */}
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
                    <img src={form.logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">Logo</div>
                  )}
                  <span className="font-bold text-sm text-gray-900">{previewName}</span>
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-2/3 bg-gray-100 rounded" />
                  <div className="h-2 w-full bg-gray-100 rounded" />
                  <div className="h-2 w-1/2 bg-gray-100 rounded" />
                </div>
                <div className="pt-2 flex justify-between items-center text-[9px] text-gray-400 border-t border-gray-50">
                  <span>{form.poweredBySchoolSync ? "Powered by SchoolSync" : ""}</span>
                  <span style={{ color: primaryColor }} className="font-semibold">Action</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

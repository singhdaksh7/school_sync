"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { GraduationCap, Building2, Phone, Mail, Globe, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    website: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create school");
        return;
      }
      // Refresh session to get new schoolSlug
      await signIn("credentials", { redirect: false });
      router.push(`/dashboard/${data.slug}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SchoolSync</span>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= s ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                {s}
              </div>
              {s < 2 && <div className={`w-16 h-1 rounded ${step > s ? "bg-blue-600" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        <Card>
          {step === 1 ? (
            <>
              <CardHeader>
                <CardTitle>Set up your school</CardTitle>
                <CardDescription>Tell us about your school to get started</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && (
                  <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="schoolName">School name *</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="schoolName"
                      className="pl-9"
                      placeholder="Greenwood High School"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address">Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="address"
                      className="pl-9"
                      placeholder="123 School Road, City"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    if (!form.name.trim()) { setError("School name is required"); return; }
                    setError("");
                    setStep(2);
                  }}
                >
                  Continue
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Contact details</CardTitle>
                <CardDescription>Optional — you can always update these later</CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  {error && (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">
                      {error}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input id="phone" className="pl-9" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="schoolEmail">School email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input id="schoolEmail" type="email" className="pl-9" placeholder="info@school.edu" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="website">Website</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input id="website" className="pl-9" placeholder="https://school.edu" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                    <Button type="submit" className="flex-1" disabled={loading}>
                      {loading ? "Creating..." : "Launch my school app"}
                    </Button>
                  </div>
                </CardContent>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

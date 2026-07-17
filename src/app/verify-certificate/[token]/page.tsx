"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ShieldCheck, ShieldX, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type VerifyResult =
  | { valid: false; status: "NOT_VERIFIABLE" }
  | {
      valid: true;
      status: "VALID" | "REVOKED";
      certificateNumber: string;
      certificateType: string;
      schoolName: string;
      studentName: string;
      issueDate: string;
      revokedAt: string | null;
    };

const TYPE_KEY: Record<string, string> = {
  BONAFIDE: "typeBonafide",
  TRANSFER_CERTIFICATE: "typeTransferCertificate",
  CHARACTER_CERTIFICATE: "typeCharacterCertificate",
  STUDY_CERTIFICATE: "typeStudyCertificate",
  CUSTOM: "typeCustom",
};

export default function VerifyCertificatePage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<"checking" | "done">("checking");
  const [result, setResult] = useState<VerifyResult | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/certificates/verify/${encodeURIComponent(params.token)}`)
      .then((res) => res.json())
      .then((data: VerifyResult) => {
        if (!active) return;
        setResult(data);
        setState("done");
      })
      .catch(() => {
        if (!active) return;
        setResult({ valid: false, status: "NOT_VERIFIABLE" });
        setState("done");
      });
    return () => {
      active = false;
    };
  }, [params.token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="mb-4 self-end">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            {state === "checking" && <ShieldQuestion className="h-6 w-6 text-muted-foreground" />}
            {state === "done" && result?.valid && result.status === "VALID" && <ShieldCheck className="h-6 w-6 text-emerald-600" />}
            {state === "done" && result?.valid && result.status === "REVOKED" && <ShieldX className="h-6 w-6 text-destructive" />}
            {state === "done" && result && !result.valid && <ShieldX className="h-6 w-6 text-destructive" />}
            {t("certificateVerify.title")}
          </CardTitle>
          <CardDescription>{t("certificateVerify.footerNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {state === "checking" && <p className="text-center text-sm text-muted-foreground">{t("certificateVerify.checking")}</p>}

          {state === "done" && (!result || !result.valid) && (
            <div className="space-y-2 text-center">
              <Badge variant="destructive">{t("certificateVerify.invalidTitle")}</Badge>
              <p className="text-sm text-muted-foreground">{t("certificateVerify.invalidDescription")}</p>
            </div>
          )}

          {state === "done" && result?.valid && (
            <div className="space-y-3">
              <div className="flex justify-center">
                <Badge variant={result.status === "VALID" ? "success" : "destructive"}>
                  {result.status === "VALID" ? t("certificateVerify.validBadge") : t("certificateVerify.revokedBadge")}
                </Badge>
              </div>
              <dl className="divide-y rounded-md border text-sm">
                <Row label={t("certificateVerify.certificateNumber")} value={result.certificateNumber} />
                <Row label={t("certificateVerify.certificateType")} value={t(`certificateVerify.${TYPE_KEY[result.certificateType] ?? "typeCustom"}`)} />
                <Row label={t("certificateVerify.school")} value={result.schoolName} />
                <Row label={t("certificateVerify.student")} value={result.studentName} />
                <Row label={t("certificateVerify.issueDate")} value={new Date(result.issueDate).toLocaleDateString()} />
                {result.status === "REVOKED" && result.revokedAt && (
                  <Row label={t("certificateVerify.revokedOn")} value={new Date(result.revokedAt).toLocaleDateString()} />
                )}
              </dl>
              {result.status === "REVOKED" && <p className="text-center text-sm text-destructive">{t("certificateVerify.revokedNotice")}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

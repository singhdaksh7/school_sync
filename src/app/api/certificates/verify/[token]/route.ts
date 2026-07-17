import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashVerificationToken } from "@/lib/certificates/verification-token";
import { serializePublicVerification } from "@/lib/certificates/serializers";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/auth-response";
import { getClientIp } from "@/lib/request-ip";

const INVALID_RESULT = NextResponse.json({ valid: false, status: "NOT_VERIFIABLE" }, { status: 200 });

/**
 * Public, unauthenticated, read-only certificate verification (spec §8).
 * Unknown tokens return the exact same generic payload/status as any other
 * invalid token — no distinguishable error, no existence leak. Revoked
 * certificates remain verifiable (status REVOKED, with revocation date) but
 * never expose the private revocation reason.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = getClientIp(req);
  const limited = await rateLimit(`certificate-verify:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.certificateVerify);
  if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSeconds);

  if (!token || token.length < 10) return INVALID_RESULT;

  const tokenHash = hashVerificationToken(token);
  const issued = await prisma.issuedCertificate.findUnique({
    where: { verificationTokenHash: tokenHash },
    select: {
      certificateNumber: true,
      certificateType: true,
      issueDate: true,
      revokedAt: true,
      school: { select: { name: true } },
      student: { select: { name: true } },
    },
  });
  if (!issued) return INVALID_RESULT;

  return NextResponse.json(
    serializePublicVerification({
      certificateNumber: issued.certificateNumber,
      certificateType: issued.certificateType,
      issueDate: issued.issueDate,
      revokedAt: issued.revokedAt,
      schoolName: issued.school.name,
      studentName: issued.student.name,
    })
  );
}

import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export interface ParentTokenPayload {
  guardianId: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  schoolId: string;
  schoolSlug: string;
}

export function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length > 0) return `+${digits}`;
  return digits;
}

export function verifyParentToken(token: string): ParentTokenPayload | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
    const decoded = jwt.verify(token, secret) as ParentTokenPayload;
    if (!decoded.guardianId || !decoded.schoolId || decoded.role !== "PARENT") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function generateParentToken(payload: ParentTokenPayload): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export async function getAuthenticatedGuardian(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const decoded = verifyParentToken(token);
  if (!decoded) return null;

  const guardian = await prisma.guardian.findFirst({
    where: {
      id: decoded.guardianId,
      schoolId: decoded.schoolId,
    },
    select: {
      id: true,
      schoolId: true,
      name: true,
      phone: true,
      email: true,
    },
  });

  return guardian ? { decoded, guardian } : null;
}

export async function guardianCanAccessStudent(guardianId: string, schoolId: string, studentId: string) {
  const link = await prisma.studentGuardian.findFirst({
    where: {
      guardianId,
      schoolId,
      studentId,
      student: { schoolId },
      guardian: { schoolId },
    },
    select: { studentId: true },
  });
  return Boolean(link);
}

import jwt from "jsonwebtoken";

export interface ParentTokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  schoolId: string;
  schoolSlug: string;
}

export function verifyParentToken(token: string): ParentTokenPayload | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
    const decoded = jwt.verify(token, secret) as ParentTokenPayload;
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

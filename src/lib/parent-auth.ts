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
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "secret"
    ) as ParentTokenPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export function generateParentToken(payload: ParentTokenPayload): string {
  return jwt.sign(payload, process.env.NEXTAUTH_SECRET || "secret", {
    expiresIn: "7d",
  });
}

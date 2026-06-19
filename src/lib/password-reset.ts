import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 45 * 60 * 1000;

function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Issues a fresh single-use reset token, invalidating any unused tokens
 * already on file for this user. Returns the raw token — only its hash is stored. */
export async function createPasswordResetToken(userId: string) {
  const rawToken = crypto.randomBytes(32).toString("base64url");

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);

  return rawToken;
}

/** Read-only check used by the reset-password page to decide which UI state to render. */
export async function validatePasswordResetToken(rawToken: string) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  return { userId: record.user.id, role: record.user.role };
}

/** Validates the token and atomically rotates the password, marking the token
 * (and any sibling tokens for the same user) used so it can never be replayed. */
export async function consumePasswordResetToken(rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  return prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) return null;

    await tx.user.update({ where: { id: record.userId }, data: { password: hashedPassword } });
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    return { userId: record.user.id, role: record.user.role };
  });
}

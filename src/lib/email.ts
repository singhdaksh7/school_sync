import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name only — the underlying configured sender ADDRESS never changes
   * (see resolveFromHeader). This is how tenant branding reaches an email
   * without faking domain ownership or spoofing an arbitrary From address. */
  fromDisplayName?: string;
}

interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

const PLATFORM_FROM_DISPLAY_NAME = "SchoolSync";

/** Dev-mode fallback — logs the email instead of sending it. Never logs the
 * password itself; only the recipient and a link/token are ever printed here. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

class ResendEmailProvider implements EmailProvider {
  private client: Resend;
  private fromAddress: string;

  constructor(apiKey: string, fromAddress: string) {
    this.client = new Resend(apiKey);
    this.fromAddress = fromAddress;
  }

  async send(message: EmailMessage) {
    // Display-name branding only ("Green Valley School via SchoolSync <addr>")
    // — the actual configured sender ADDRESS is never altered per message, so
    // this can never be used to claim ownership of a domain we don't control.
    const displayName = message.fromDisplayName ?? PLATFORM_FROM_DISPLAY_NAME;
    const { error } = await this.client.emails.send({
      from: `${displayName} <${this.fromAddress}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(`Resend send failed: ${error.message}`);
  }
}

function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendEmailProvider(apiKey, process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev");
  }
  return new ConsoleEmailProvider();
}

/**
 * Resolves the tenant (school) name for a user, for SCHOOL/TENANT operational
 * emails (password reset, invites, etc). Returns null for platform-level
 * actors (Founder) or when no school can be resolved — callers fall back to
 * platform (SchoolSync) branding in that case. Never used for authorization,
 * only for email display branding.
 */
export async function resolveSchoolNameForUser(userId: string, role: string): Promise<string | null> {
  if (role === "FOUNDER") return null;
  if (role === "TEACHER") {
    const teacher = await prisma.teacher.findFirst({
      where: { userId, isDeleted: false },
      select: { school: { select: { name: true } } },
    });
    return teacher?.school.name ?? null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ownedSchool: { select: { name: true } }, school: { select: { name: true } } },
  });
  return user?.ownedSchool?.name ?? user?.school?.name ?? null;
}

/**
 * Password reset is a SCHOOL/TENANT operational email when the account
 * belongs to a school (the overwhelming majority of users); Founder accounts
 * fall back to platform branding. `schoolName` is display-only — the sender
 * address and reset token/link are unaffected either way.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string, schoolName?: string | null) {
  const provider = getEmailProvider();
  const brand = schoolName ?? "SchoolSync";
  const fromDisplayName = schoolName ? `${schoolName} via SchoolSync` : PLATFORM_FROM_DISPLAY_NAME;
  await provider.send({
    to,
    fromDisplayName,
    subject: `Reset your ${brand} password`,
    text: `We received a request to reset your ${brand} password. Use the link below within the next 45 minutes to set a new password:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>We received a request to reset your ${brand} password. Use the link below within the next 45 minutes to set a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

const ROLE_LABELS: Record<string, string> = {
  SCHOOL_ADMIN: "School Admin",
  VICE_PRINCIPAL: "Vice Principal",
  TEACHER: "Teacher",
};

/** Staff invites are always SCHOOL/TENANT operational — schoolName is required (the invite is always for a specific school). */
export async function sendStaffInviteEmail(
  to: string,
  opts: { name: string; role: string; schoolName: string; inviteLink: string }
) {
  const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
  const provider = getEmailProvider();
  await provider.send({
    to,
    fromDisplayName: `${opts.schoolName} via SchoolSync`,
    subject: `You're invited to join ${opts.schoolName}`,
    text: `Hello ${opts.name},\n\nYou have been invited to join ${opts.schoolName} as:\n\n${roleLabel}\n\nClick below to create your account:\n\n${opts.inviteLink}\n\nThis link expires in 7 days.`,
    html: `<p>Hello ${opts.name},</p><p>You have been invited to join <strong>${opts.schoolName}</strong> as:</p><p><strong>${roleLabel}</strong></p><p><a href="${opts.inviteLink}">Click here to create your account</a></p><p>This link expires in 7 days.</p>`,
  });
}

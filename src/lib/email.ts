import { Resend } from "resend";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
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
 * password itself; only the recipient and a link/token are ever printed here.
 * Refuses to run in production even if directly constructed — the only
 * intended way to reach this class is through getEmailProvider(), which
 * already excludes it in production, but this is a second, independent gate
 * so a future call site can never accidentally log a reset link/invite to
 * stdout in a real deployment. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ConsoleEmailProvider must never be used in production — this is a defense-in-depth check, not expected to be reachable.");
    }
    console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

/** Selected when the explicit/defaulted EMAIL_PROVIDER selection can't
 * actually be used (missing prerequisites, unsupported value, or "console"
 * requested in production). Every call fails loudly (the caller's existing
 * error handling turns this into a generic 500 — see e.g.
 * src/app/api/auth/forgot-password/route.ts) instead of silently no-op'ing
 * or falling back to another provider / logging the message content (which
 * would include a password-reset link/invite token). Nothing about the
 * message — recipient, token, or link — is ever logged here. */
class UnavailableEmailProvider implements EmailProvider {
  async send(): Promise<void> {
    throw new Error(
      "No usable email provider is configured — set EMAIL_PROVIDER=ses with EMAIL_FROM (+ SES_REGION or STORAGE_REGION), or EMAIL_PROVIDER=resend with RESEND_API_KEY. EMAIL_PROVIDER defaults to \"ses\" in production."
    );
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

/**
 * AWS SES (v2 API) email provider. Credentials are never read from
 * environment variables or passed to the client explicitly — the SESv2Client
 * uses the AWS SDK's default credential provider chain, same pattern as
 * S3StorageProvider (src/lib/storage-s3.ts): on ECS this resolves to the web
 * task's IAM role (temporary, auto-rotating; see infra/terraform/iam.tf /
 * ses.tf), and in local development it resolves to whatever ambient AWS
 * identity is already configured (`aws configure`, SSO, env vars set by the
 * developer's own shell, etc. — never something this class manages).
 */
class SesEmailProvider implements EmailProvider {
  private client: SESv2Client;
  private fromAddress: string;

  constructor(region: string, fromAddress: string) {
    this.client = new SESv2Client({ region });
    this.fromAddress = fromAddress;
  }

  async send(message: EmailMessage) {
    const displayName = message.fromDisplayName ?? PLATFORM_FROM_DISPLAY_NAME;
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: `${displayName} <${this.fromAddress}>`,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: message.html, Charset: "UTF-8" },
                Text: { Data: message.text, Charset: "UTF-8" },
              },
            },
          },
        })
      );
    } catch (err) {
      // Never include message content (recipient/subject/body carry the
      // reset link or invite token) in the rethrown error — only the SES
      // failure reason, which callers' existing catch blocks already log.
      const reason = err instanceof Error ? err.message : "unknown error";
      throw new Error(`SES send failed: ${reason}`);
    }
  }
}

export type EmailProviderKind = "resend" | "ses" | "console" | "unavailable";

const SUPPORTED_PROVIDERS = new Set(["ses", "resend", "console"]);

/** Case-normalizes EMAIL_PROVIDER ("SES", " Resend ", etc.) — returns
 * undefined for unset/empty, and the raw lowercased/trimmed value otherwise
 * (validity against SUPPORTED_PROVIDERS is checked by the caller so an
 * invalid value can be distinguished from "unset"). */
function normalizeProviderName(raw: string | undefined): string | undefined {
  const normalized = raw?.trim().toLowerCase();
  return normalized || undefined;
}

function sesReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.EMAIL_FROM && (env.SES_REGION || env.STORAGE_REGION));
}

function resendReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Which provider getEmailProvider() would select right now, without
 * constructing it — surfaced by /api/health readiness and directly testable
 * (see tests/email-provider.test.ts) without touching the Resend/SES SDKs.
 *
 * EMAIL_PROVIDER is the explicit, case-normalized selector — production must
 * never silently pick Resend just because RESEND_API_KEY happens to be set.
 * There is NO fallback between providers: if the selected (or defaulted)
 * provider's prerequisites aren't met, the result is "unavailable", even if
 * another provider's env vars happen to be present.
 *
 *   EMAIL_PROVIDER unset:
 *     - production      -> defaults to "ses" (the preferred production
 *                          provider) — "unavailable" if EMAIL_FROM/region
 *                          aren't also set.
 *     - non-production   -> "console" (existing dev-mode default).
 *   EMAIL_PROVIDER="ses"     -> "ses" if EMAIL_FROM + a resolvable region are
 *                               set, else "unavailable".
 *   EMAIL_PROVIDER="resend"  -> "resend" if RESEND_API_KEY is set (backward
 *                               compatibility, explicit opt-in only), else
 *                               "unavailable".
 *   EMAIL_PROVIDER="console" -> "console" outside production; "unavailable"
 *                               in production (console is never a valid
 *                               production delivery path — see
 *                               ConsoleEmailProvider's own second gate below).
 *   EMAIL_PROVIDER=<anything else> (unsupported/typo) -> "unavailable".
 */
export function getEmailProviderKind(env: NodeJS.ProcessEnv = process.env): EmailProviderKind {
  const isProd = env.NODE_ENV === "production";
  const raw = normalizeProviderName(env.EMAIL_PROVIDER);
  const selected = raw ?? (isProd ? "ses" : "console");

  if (!SUPPORTED_PROVIDERS.has(selected)) return "unavailable";

  switch (selected) {
    case "ses":
      return sesReady(env) ? "ses" : "unavailable";
    case "resend":
      return resendReady(env) ? "resend" : "unavailable";
    case "console":
      return isProd ? "unavailable" : "console";
    default:
      return "unavailable";
  }
}

/**
 * True when a production-capable provider (SES or Resend) is configured —
 * used by /api/health readiness reporting. Deliberately does not consider
 * ConsoleEmailProvider "configured": that provider is dev-only and never a
 * valid production delivery path.
 */
export function isEmailConfigured(): boolean {
  const kind = getEmailProviderKind();
  return kind === "resend" || kind === "ses";
}

export function getEmailProvider(): EmailProvider {
  switch (getEmailProviderKind()) {
    case "resend":
      return new ResendEmailProvider(process.env.RESEND_API_KEY!, process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || "onboarding@resend.dev");
    case "ses":
      // EMAIL_PROVIDER=ses (explicit or the production default) is the "use
      // SES" signal; there is no SES API-key env var by design — credentials
      // always come from the AWS SDK default chain, never an environment
      // variable. Reuses STORAGE_REGION when SES_REGION isn't set
      // separately, since SES is typically provisioned in the same region as
      // the S3 bucket.
      return new SesEmailProvider((process.env.SES_REGION || process.env.STORAGE_REGION)!, process.env.EMAIL_FROM!);
    case "unavailable":
      return new UnavailableEmailProvider();
    case "console":
      return new ConsoleEmailProvider();
  }
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

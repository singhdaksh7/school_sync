import { Resend } from "resend";

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Dev-mode fallback — logs the email instead of sending it. Never logs the
 * password itself; only the recipient and a link/token are ever printed here. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

class ResendEmailProvider implements EmailProvider {
  private client: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(message: EmailMessage) {
    const { error } = await this.client.emails.send({
      from: this.from,
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

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const provider = getEmailProvider();
  await provider.send({
    to,
    subject: "Reset your SchoolSync password",
    text: `We received a request to reset your SchoolSync password. Use the link below within the next 45 minutes to set a new password:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>We received a request to reset your SchoolSync password. Use the link below within the next 45 minutes to set a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

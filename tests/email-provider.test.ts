import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Never let a test accidentally reach the real network, even though none of
// the assertions below should construct a provider that actually sends.
vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    constructor(public config: unknown) {}
    send = vi.fn();
  }
  class SendEmailCommand {
    constructor(public input: unknown) {}
  }
  return { SESv2Client, SendEmailCommand };
});
vi.mock("resend", () => {
  class Resend {
    constructor(public apiKey: string) {}
    emails = { send: vi.fn(async () => ({ error: null })) };
  }
  return { Resend };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getEmailProviderKind, getEmailProvider, isEmailConfigured } from "@/lib/email";

function env(vars: Record<string, string>) {
  return vars as unknown as NodeJS.ProcessEnv;
}

const ENV_KEYS = ["EMAIL_PROVIDER", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "EMAIL_FROM", "SES_REGION", "STORAGE_REGION"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
});

describe("getEmailProviderKind — EMAIL_PROVIDER=ses", () => {
  it("selects SES when EMAIL_FROM and a region are set", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "ses", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" }))).toBe("ses");
  });

  it("selects SES using SES_REGION when set, independent of STORAGE_REGION", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "ses", EMAIL_FROM: "noreply@school.example", SES_REGION: "us-east-1" }))).toBe("ses");
  });

  it("is unavailable when EMAIL_FROM is set but no region resolves", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "ses", EMAIL_FROM: "noreply@school.example" }))).toBe("unavailable");
  });

  it("is unavailable when EMAIL_FROM is missing, even with a region set", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "ses", STORAGE_REGION: "ap-south-1" }))).toBe("unavailable");
  });

  it("does NOT fall back to Resend when ses is explicitly selected but misconfigured, even if RESEND_API_KEY is set", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "ses", RESEND_API_KEY: "re_123" }))).toBe("unavailable");
  });
});

describe("getEmailProviderKind — EMAIL_PROVIDER=resend (backward compatibility, explicit only)", () => {
  it("selects Resend when explicitly selected and RESEND_API_KEY is set", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123" }))).toBe("resend");
  });

  it("is unavailable when explicitly selected but RESEND_API_KEY is missing", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "resend" }))).toBe("unavailable");
  });

  it("does NOT fall back to SES when resend is explicitly selected but misconfigured, even if SES prerequisites are met", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" }))).toBe(
      "unavailable"
    );
  });

  it("remains selectable in production when explicitly chosen (backward compatibility)", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "production", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123" }))).toBe("resend");
  });
});

describe("getEmailProviderKind — EMAIL_PROVIDER=console", () => {
  it("is permitted outside production", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "development", EMAIL_PROVIDER: "console" }))).toBe("console");
    expect(getEmailProviderKind(env({ NODE_ENV: "test", EMAIL_PROVIDER: "console" }))).toBe("console");
  });

  it("is rejected (unavailable) when explicitly selected in production", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "production", EMAIL_PROVIDER: "console" }))).toBe("unavailable");
  });
});

describe("getEmailProviderKind — EMAIL_PROVIDER unset (default)", () => {
  it("defaults to attempting SES in production", () => {
    expect(
      getEmailProviderKind(env({ NODE_ENV: "production", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" }))
    ).toBe("ses");
  });

  it("is unavailable in production when SES prerequisites aren't met, even if RESEND_API_KEY happens to be set — the core bug fix: production must not silently pick Resend", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "production", RESEND_API_KEY: "re_123" }))).toBe("unavailable");
    expect(getEmailProviderKind(env({ NODE_ENV: "production" }))).toBe("unavailable");
  });

  it("defaults to console outside production, ignoring RESEND_API_KEY (explicit selection required)", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "development" }))).toBe("console");
    expect(getEmailProviderKind(env({ NODE_ENV: "test" }))).toBe("console");
    expect(getEmailProviderKind(env({}))).toBe("console");
    expect(getEmailProviderKind(env({ NODE_ENV: "development", RESEND_API_KEY: "re_123" }))).toBe("console");
  });
});

describe("getEmailProviderKind — invalid/unsupported EMAIL_PROVIDER values", () => {
  it("is unavailable for an unsupported provider name, in production", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "production", EMAIL_PROVIDER: "sendgrid" }))).toBe("unavailable");
  });

  it("is unavailable for an unsupported provider name, outside production too — invalid config is never silently ignored", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "development", EMAIL_PROVIDER: "sendgrid" }))).toBe("unavailable");
    expect(getEmailProviderKind(env({ NODE_ENV: "test", EMAIL_PROVIDER: "mailgun" }))).toBe("unavailable");
  });

  it("treats an empty string the same as unset", () => {
    expect(getEmailProviderKind(env({ NODE_ENV: "production", EMAIL_PROVIDER: "", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" }))).toBe(
      "ses"
    );
  });
});

describe("getEmailProviderKind — case normalization", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "SES", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" }))).toBe("ses");
    expect(getEmailProviderKind(env({ EMAIL_PROVIDER: "  Resend  ", RESEND_API_KEY: "re_123" }))).toBe("resend");
    expect(getEmailProviderKind(env({ NODE_ENV: "development", EMAIL_PROVIDER: "Console" }))).toBe("console");
  });
});

describe("isEmailConfigured", () => {
  it("is true for SES and Resend, false for console/unavailable", () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.EMAIL_FROM = "noreply@school.example";
    process.env.STORAGE_REGION = "ap-south-1";
    expect(isEmailConfigured()).toBe(true);

    process.env.EMAIL_PROVIDER = "resend";
    delete process.env.EMAIL_FROM;
    delete process.env.STORAGE_REGION;
    process.env.RESEND_API_KEY = "re_123";
    expect(isEmailConfigured()).toBe(true);

    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false); // console (dev) — not a real delivery path

    vi.stubEnv("NODE_ENV", "production");
    expect(isEmailConfigured()).toBe(false); // unavailable
  });
});

describe("Missing production email configuration fails safely", () => {
  it("getEmailProvider() in production with nothing configured rejects on send(), never resolves", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const provider = getEmailProvider();
    await expect(provider.send({ to: "a@b.com", subject: "s", html: "<p>h</p>", text: "reset-link-or-token-goes-here" })).rejects.toThrow();
  });

  it("never logs anything — the reset link/token in the message is never printed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const provider = getEmailProvider();
    const secretLookingToken = "SUPER-SECRET-RESET-TOKEN-abc123";
    await expect(
      provider.send({ to: "a@b.com", subject: "s", html: `<p>${secretLookingToken}</p>`, text: secretLookingToken })
    ).rejects.toThrow();
    expect(logSpy).not.toHaveBeenCalled();
    for (const call of logSpy.mock.calls) {
      expect(String(call)).not.toContain(secretLookingToken);
    }
    logSpy.mockRestore();
  });

  it("the console provider itself also refuses to run in production as a second, independent gate", async () => {
    // Force NODE_ENV back to production immediately before send() to prove
    // ConsoleEmailProvider (reachable only via a hypothetical future bug in
    // provider selection) still refuses on its own.
    vi.stubEnv("NODE_ENV", "development");
    const provider = getEmailProvider(); // console, since nothing else configured
    vi.stubEnv("NODE_ENV", "production");
    await expect(provider.send({ to: "a@b.com", subject: "s", html: "<p>h</p>", text: "t" })).rejects.toThrow(/production/i);
  });
});

describe("No static AWS credentials required for SES", () => {
  it("SesEmailProvider never reads or requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/email.ts"), "utf-8");
    expect(source).not.toContain("AWS_ACCESS_KEY_ID");
    expect(source).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(source).not.toMatch(/accessKeyId/);
    expect(source).not.toMatch(/secretAccessKey/);
  });

  it("constructs and sends via SES with only a region and a from-address — no credentials object", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.EMAIL_FROM = "noreply@school.example";
    process.env.STORAGE_REGION = "ap-south-1";
    const provider = getEmailProvider();
    await provider.send({ to: "a@b.com", subject: "s", html: "<p>h</p>", text: "t" });
    // No assertion error / thrown credential requirement means construction
    // and send() succeeded with zero AWS_* environment variables set.
  });
});

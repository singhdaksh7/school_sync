import { describe, it, expect, afterEach } from "vitest";
import { resolveS3Credentials, s3ConfigFromEnv } from "@/lib/storage-s3";
import { isStorageConfigured } from "@/lib/storage";

const STORAGE_ENV_KEYS = [
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_ENDPOINT",
  "STORAGE_PUBLIC_BASE_URL",
] as const;

/** Saves/restores the STORAGE_* env vars this suite mutates, per test. */
function withStorageEnv(overrides: Partial<Record<(typeof STORAGE_ENV_KEYS)[number], string>>, run: () => void) {
  const previous: Partial<Record<string, string | undefined>> = {};
  for (const key of STORAGE_ENV_KEYS) previous[key] = process.env[key];
  try {
    for (const key of STORAGE_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    run();
  } finally {
    for (const key of STORAGE_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

describe("resolveS3Credentials — ECS task role / explicit credential selection", () => {
  it("explicit local credentials: both accessKeyId and secretAccessKey set -> returns the pair", () => {
    const result = resolveS3Credentials("AKIA_TEST", "shh-secret");
    expect(result).toEqual({ accessKeyId: "AKIA_TEST", secretAccessKey: "shh-secret" });
  });

  it("no explicit credentials: both unset -> returns undefined (default credential provider chain, e.g. ECS task role)", () => {
    expect(resolveS3Credentials(undefined, undefined)).toBeUndefined();
    expect(resolveS3Credentials("", "")).toBeUndefined();
  });

  it("incomplete pair: only accessKeyId set -> throws rather than silently using a broken partial config", () => {
    expect(() => resolveS3Credentials("AKIA_TEST", undefined)).toThrow(/must both be set/i);
  });

  it("incomplete pair: only secretAccessKey set -> throws rather than silently using a broken partial config", () => {
    expect(() => resolveS3Credentials(undefined, "shh-secret")).toThrow(/must both be set/i);
  });
});

describe("s3ConfigFromEnv — credentials optional at the env-resolution boundary", () => {
  afterEach(() => {
    for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  });

  it("returns null when bucket/region are missing, regardless of credentials", () => {
    withStorageEnv({ STORAGE_ACCESS_KEY_ID: "AKIA_TEST", STORAGE_SECRET_ACCESS_KEY: "shh-secret" }, () => {
      expect(s3ConfigFromEnv()).toBeNull();
    });
  });

  it("bucket+region only (no access keys) -> config resolves with credentials undefined", () => {
    withStorageEnv({ STORAGE_BUCKET: "schoolsync-staging", STORAGE_REGION: "ap-south-1" }, () => {
      const cfg = s3ConfigFromEnv();
      expect(cfg).not.toBeNull();
      expect(cfg?.credentials).toBeUndefined();
    });
  });

  it("bucket+region+full key pair -> config resolves with explicit credentials", () => {
    withStorageEnv(
      {
        STORAGE_BUCKET: "schoolsync-staging",
        STORAGE_REGION: "ap-south-1",
        STORAGE_ACCESS_KEY_ID: "AKIA_TEST",
        STORAGE_SECRET_ACCESS_KEY: "shh-secret",
      },
      () => {
        const cfg = s3ConfigFromEnv();
        expect(cfg?.credentials).toEqual({ accessKeyId: "AKIA_TEST", secretAccessKey: "shh-secret" });
      }
    );
  });

  it("bucket+region+incomplete key pair -> throws instead of returning a broken config", () => {
    withStorageEnv(
      { STORAGE_BUCKET: "schoolsync-staging", STORAGE_REGION: "ap-south-1", STORAGE_ACCESS_KEY_ID: "AKIA_TEST" },
      () => {
        expect(() => s3ConfigFromEnv()).toThrow(/must both be set/i);
      }
    );
  });
});

describe("isStorageConfigured — readiness reflects the same all-or-nothing contract", () => {
  afterEach(() => {
    for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  });

  it("true when bucket+region set and no access keys (ECS task-role mode)", () => {
    withStorageEnv({ STORAGE_BUCKET: "b", STORAGE_REGION: "ap-south-1" }, () => {
      expect(isStorageConfigured()).toBe(true);
    });
  });

  it("true when bucket+region+full key pair set (local dev mode)", () => {
    withStorageEnv(
      { STORAGE_BUCKET: "b", STORAGE_REGION: "ap-south-1", STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s" },
      () => {
        expect(isStorageConfigured()).toBe(true);
      }
    );
  });

  it("false (not thrown) when an incomplete key pair is present — fails safe via NotConfiguredStorageProvider rather than crashing", () => {
    withStorageEnv({ STORAGE_BUCKET: "b", STORAGE_REGION: "ap-south-1", STORAGE_ACCESS_KEY_ID: "k" }, () => {
      expect(isStorageConfigured()).toBe(false);
    });
  });

  it("false when bucket/region are missing", () => {
    withStorageEnv({}, () => {
      expect(isStorageConfigured()).toBe(false);
    });
  });
});

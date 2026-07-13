import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXTAUTH_SECRET = "test-secret-for-proxy-cookie-protocol-suite";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { proxy, isForwardedHttps } from "@/proxy";

const getTokenMock = getToken as unknown as ReturnType<typeof vi.fn>;

function reqWithForwardedProto(pathname: string, forwardedProto: string | null, urlProtocol: "http" | "https" = "https") {
  const url = `${urlProtocol}://app.schoolsync.test${pathname}`;
  const headers = new Headers();
  if (forwardedProto !== null) headers.set("x-forwarded-proto", forwardedProto);
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isForwardedHttps — protocol-aware cookie selection, never NODE_ENV", () => {
  it("forwarded http -> false (non-secure cookie lookup)", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "http"))).toBe(false);
  });

  it("forwarded https -> true (secure cookie lookup)", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "https"))).toBe(true);
  });

  it("comma-separated x-forwarded-proto: first hop (client-facing) wins, later hops ignored", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "https, http"))).toBe(true);
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "http, https"))).toBe(false);
  });

  it("normalizes whitespace and case in the forwarded value", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "  HTTPS  "))).toBe(true);
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "  HTTP  "))).toBe(false);
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", " Https , Http "))).toBe(true);
  });

  it("missing x-forwarded-proto, HTTPS request URL -> falls back to true", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", null, "https"))).toBe(true);
  });

  it("missing x-forwarded-proto, HTTP request URL -> falls back to false", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", null, "http"))).toBe(false);
  });

  it("an unrecognized forwarded-proto value is treated as non-secure (matches Auth.js's own strict '=== \"https:\"' check, never assumes secure)", () => {
    expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "ftp"))).toBe(false);
  });

  it("never consults NODE_ENV — a production NODE_ENV with an HTTP-forwarded request still resolves to false", () => {
    const original = process.env.NODE_ENV;
    // @ts-expect-error test-only override of a readonly-typed env var
    process.env.NODE_ENV = "production";
    try {
      expect(isForwardedHttps(reqWithForwardedProto("/dashboard/school-one", "http"))).toBe(false);
    } finally {
      // @ts-expect-error restoring the test-only override
      process.env.NODE_ENV = original;
    }
  });
});

describe("proxy() — passes the protocol-derived secureCookie value through to getToken(), not NODE_ENV", () => {
  it("HTTP-forwarded request: getToken() is called with secureCookie: false", async () => {
    getTokenMock.mockResolvedValue({ role: "SCHOOL_OWNER", schoolSlug: "school-one" });
    await proxy(reqWithForwardedProto("/dashboard/school-one", "http"));
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: false }));
  });

  it("HTTPS-forwarded request: getToken() is called with secureCookie: true", async () => {
    getTokenMock.mockResolvedValue({ role: "SCHOOL_OWNER", schoolSlug: "school-one" });
    await proxy(reqWithForwardedProto("/dashboard/school-one", "https"));
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
  });

  it("this holds even with NODE_ENV=production and an HTTP-forwarded request (the exact regression this fix targets)", async () => {
    const original = process.env.NODE_ENV;
    // @ts-expect-error test-only override of a readonly-typed env var
    process.env.NODE_ENV = "production";
    try {
      getTokenMock.mockResolvedValue({ role: "SCHOOL_OWNER", schoolSlug: "school-one" });
      await proxy(reqWithForwardedProto("/dashboard/school-one", "http"));
      expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: false }));
    } finally {
      // @ts-expect-error restoring the test-only override
      process.env.NODE_ENV = original;
    }
  });
});

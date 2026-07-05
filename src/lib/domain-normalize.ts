/**
 * Centralized custom-domain hostname normalization/validation. Deliberately
 * NOT one fragile regex — uses Node's standard `domainToASCII` for IDN/
 * punycode handling plus explicit structural checks, so each rejection reason
 * is distinguishable (protocol, path, port, IP, wildcard, malformed label...).
 *
 * This is intentionally stricter than school-resolver.ts's `normalizeHostname`
 * (which just extracts a hostname from a Host header for lookup) — this one
 * VALIDATES a hostname a school owner is claiming for their custom domain.
 */
import { domainToASCII } from "node:url";

const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export type DomainNormalizationResult = { ok: true; hostname: string } | { ok: false; error: string };

/** Validates and normalizes a client-submitted custom-domain hostname claim. */
export function normalizeDomainInput(raw: string | null | undefined): DomainNormalizationResult {
  if (!raw || typeof raw !== "string") return { ok: false, error: "Domain is required" };

  let value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: "Domain is required" };
  if (/\s/.test(value)) return { ok: false, error: "Domain must not contain whitespace" };
  if (value.includes("@")) return { ok: false, error: "Domain must not contain credentials" };
  if (value.includes("*")) return { ok: false, error: "Wildcard domains are not supported" };

  // Accept (and strip) a leading http(s):// but reject any other scheme.
  const protocolMatch = /^([a-z][a-z0-9+.-]*):\/\//.exec(value);
  if (protocolMatch) {
    if (protocolMatch[1] !== "http" && protocolMatch[1] !== "https") {
      return { ok: false, error: "Unsupported protocol" };
    }
    value = value.slice(protocolMatch[0].length);
  }
  if (value.includes("/") || value.includes("?") || value.includes("#")) {
    return { ok: false, error: "Domain must not include a path" };
  }
  if (value.startsWith("[") || value.includes("::")) {
    return { ok: false, error: "Raw IP addresses are not supported" };
  }
  // Reject an explicit port (hostname-only input is required).
  const portMatch = /:(\d+)$/.exec(value);
  if (portMatch) return { ok: false, error: "Domain must not include a port" };

  value = value.replace(/\.+$/, ""); // trailing dot(s)
  if (!value) return { ok: false, error: "Domain is required" };
  if (value.length > MAX_HOSTNAME_LENGTH) return { ok: false, error: "Domain is too long" };

  if (LOCAL_HOSTS.has(value)) return { ok: false, error: "localhost is not a valid production domain" };
  if (IPV4_RE.test(value)) return { ok: false, error: "Raw IP addresses are not supported" };

  const ascii = domainToASCII(value);
  if (!ascii) return { ok: false, error: "Invalid domain" };
  value = ascii;

  const labels = value.split(".");
  if (labels.length < 2) return { ok: false, error: "Domain must include at least one dot (e.g. erp.example.com)" };
  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH || !LABEL_RE.test(label)) {
      return { ok: false, error: `Invalid domain label: "${label}"` };
    }
  }

  return { ok: true, hostname: value };
}

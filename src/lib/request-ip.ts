type HeaderReader = { get(name: string): string | null };

/** Best-effort client IP extraction from a header bag. Trusts
 * x-forwarded-for/x-real-ip from a reverse proxy/CDN in front of the app. */
export function getClientIpFromHeaders(headers: HeaderReader): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

/** Best-effort client IP extraction — not a substitute for infra-level trust
 * configuration, but sufficient for audit-log "if available" capture. */
export function getClientIp(req: Request): string | null {
  return getClientIpFromHeaders(req.headers);
}

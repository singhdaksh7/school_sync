/** Best-effort client IP extraction. Trusts x-forwarded-for/x-real-ip from a
 * reverse proxy/CDN in front of the app — not a substitute for infra-level
 * trust configuration, but sufficient for audit-log "if available" capture. */
export function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

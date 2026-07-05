# Custom Domain — Deployment Guide

## Does DNS ownership verification automatically provision hosting/TLS for the custom domain?

**NO.**

This is important to state plainly because the three concerns are easy to
conflate:

- **DOMAIN OWNERSHIP VERIFICATION: COMPLETE.** `src/lib/custom-domain.ts`
  proves a school actually controls a hostname via a DNS TXT record before
  marking it `VERIFIED`.
- **HOST RESOLUTION: COMPLETE.** `src/lib/school-resolver.ts`'s
  `resolveSchool()` only matches a `VERIFIED` `CustomDomain` row when
  serving branding/login-context for an incoming Host header —
  `PENDING`/`VERIFYING`/`FAILED`/`DISABLED` never resolve to a school.
- **HOSTING/TLS DOMAIN ATTACHMENT: REQUIRES DEPLOYMENT PLATFORM
  CONFIGURATION.** Nothing in this codebase calls a hosting provider's API
  (Vercel, Cloudflare, etc.) to actually attach the domain to the deployed
  project or provision a TLS certificate for it. Until that manual/platform
  step is done, the domain will not actually serve traffic to this app at
  all, regardless of DNS TXT verification status.

## Setup flow (school owner/admin, WHITE_LABEL feature required)

1. `POST /api/schools/[schoolId]/custom-domain { "hostname": "erp.school.com" }`
   — validates and normalizes the hostname (`src/lib/domain-normalize.ts`),
   creates a `PENDING` `CustomDomain` row with a crypto-random verification
   token, and returns the DNS instructions.
2. School adds the DNS TXT record at their DNS provider:

   ```
   Name:  _schoolsync-verification.erp.school.com
   Type:  TXT
   Value: schoolsync-verification=<token>
   ```

3. **Separately, at your hosting platform** (Vercel/etc.): add
   `erp.school.com` as a custom domain for this project, and complete
   whatever domain-attachment/TLS step that platform requires. This
   codebase does not automate this step.
4. `POST /api/schools/[schoolId]/custom-domain/verify { "domainId": "..." }`
   — performs a live DNS TXT lookup (`node:dns/promises`, Node runtime
   only — never Edge) and marks the domain `VERIFIED` on match, `FAILED`
   otherwise (with a safe, non-sensitive `failureReason`).
5. Once `VERIFIED` **and** the hosting-platform domain attachment (step 3)
   is complete, requests arriving with that Host header resolve to the
   school via `resolveSchool()`.

## Status lifecycle

`PENDING → VERIFYING → VERIFIED` (success) or `→ FAILED` (DNS mismatch/no
record — school can retry verification without starting over).
`DISABLED` — soft-removed via `DELETE`; history is preserved (the row isn't
deleted), and the hostname is not currently reclaimable by a different
school in this implementation (see the schema note on
`CustomDomain.normalizedHostname` — a documented simplification, not a
requirement violation).

## Legacy `School.customDomain`

The original free-text `School.customDomain` column is left untouched for
historical/display purposes but is **no longer used for host resolution or
accepted via the branding PATCH route** — domain claims now only happen
through the verified flow above. See the Wave C migration note in
`prisma/schema.prisma` for the exact rationale.

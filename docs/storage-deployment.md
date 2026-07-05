# Object Storage — Deployment Guide

`src/lib/storage-s3.ts` implements one S3-compatible provider (AWS SDK v3)
that works with real AWS S3 or any S3-compatible service (Cloudflare R2,
MinIO, etc.) — no vendor-specific code in any route.

## Required environment

| Variable | Required | Notes |
|---|---|---|
| `STORAGE_BUCKET` | Yes | Bucket name. |
| `STORAGE_REGION` | Yes | AWS region (or the region string your S3-compatible provider expects, e.g. `auto` for R2). |
| `STORAGE_ACCESS_KEY_ID` | Yes | |
| `STORAGE_SECRET_ACCESS_KEY` | Yes | |
| `STORAGE_ENDPOINT` | Only for R2/non-AWS | Set to your provider's S3-compatible endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`). Leave unset for real AWS S3. |
| `STORAGE_PUBLIC_BASE_URL` | Only if you want PUBLIC objects served via a CDN/custom domain | e.g. `https://cdn.yourschool.app`. Without it, PUBLIC objects fall back to a signed URL like any private object. |

All four required variables must be set together — if any is missing in
production, `getStorageProvider()` returns `NotConfiguredStorageProvider`,
which fails every operation loudly rather than silently writing to local
disk or an in-process Map. **No production file is ever written to local
filesystem or in-memory storage** — that fallback (`MemoryStorageProvider`)
is used only in dev/test (`NODE_ENV !== "production"` and unconfigured).

## Private vs. public objects

Every `StoredFile` has one of four visibilities (`src/lib/storage.ts`):

- **PUBLIC** (`BRANDING_IMAGE` only) — resolved via `STORAGE_PUBLIC_BASE_URL`
  when set, otherwise a signed URL. **No public bucket/ACL is required** —
  even "public" objects can be served entirely through signed URLs or a CDN
  in front of a fully private bucket.
- **TENANT_PRIVATE**, **SCOPED_PRIVATE**, **BILLING_PRIVATE** — always
  resolved via a short-lived signed URL (30s–1hr clamp, see
  `getDownloadUrl` in storage-s3.ts) generated only after the requesting
  route has independently authorized the caller (`resolveManagedOrLegacyUrl`,
  `/api/files/[fileId]`). Nothing about the storage layer itself decides
  authorization — it only signs URLs for callers that already passed an
  application-level check.

**No public bucket is required for private documents** — the bucket can (and
should) be entirely private; the app signs URLs at request time.

## CORS

If the browser fetches signed URLs directly (rather than the app proxying
bytes), configure CORS on the bucket to allow `GET` from your app's
origin(s). This repo's `/api/files/[fileId]` route can also stream bytes
directly for the dev/test Memory provider — for the real S3 provider it
redirects to the signed URL, so the browser talks to the storage provider
directly and CORS applies.

## Credentials

Use a dedicated IAM user/access key scoped to only this bucket (standard
least-privilege practice) — this is a deployment-platform/cloud-console
step, not something this codebase can configure for you. Never commit real
credentials; `.env.example` documents the variable names only.

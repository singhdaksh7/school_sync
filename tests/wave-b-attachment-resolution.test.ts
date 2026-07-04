import { describe, it, expect, vi } from "vitest";

/**
 * Every homework route audited in the Wave B closure pass (submissions list,
 * submission detail, parent submit, parent/school/teacher/student homework
 * list+detail) funnels through these two shared helpers rather than each
 * inlining its own resolution — so testing the helpers directly proves the
 * consistency rule for the entire response architecture at once.
 *
 * `prisma.storedFile.findUnique` is mocked (no live DB) to return one fixed
 * managed file; `getStorageProvider()` resolves to MemoryStorageProvider in
 * this test env, so no storage mock is needed — the deterministic
 * `memory://<key>` stand-in is exactly what production replaces with a real
 * signed/public URL, and never the bare storage key itself.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    storedFile: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === "file-1") {
          return {
            id: "file-1",
            storageKey: "homework_submission/s1/2026/07/uuid-file-1.pdf",
            contentType: "application/pdf",
            originalFilename: "homework.pdf",
            visibility: "SCOPED_PRIVATE",
          };
        }
        return null;
      }),
    },
  },
}));

import { resolveManagedOrLegacyFileUrl, resolveManagedOrLegacyUrl } from "@/lib/file-service";
import { withResolvedAttachments } from "@/lib/homework";

const RAW_STORAGE_KEY = "homework_submission/s1/2026/07/uuid-file-1.pdf";
const LEGACY_URL = "https://legacy.example.com/old-homework.pdf";

describe("managed attachment resolution — consistent across the homework response architecture", () => {
  it("prefers the managed file over a legacy URL when both are present", async () => {
    const url = await resolveManagedOrLegacyUrl({ attachmentUrl: LEGACY_URL, attachmentFileId: "file-1" });
    expect(url).toBe(`memory://${RAW_STORAGE_KEY}`);
    expect(url).not.toContain("legacy.example.com");
  });

  it("falls back to the validated legacy URL when there is no managed file (intentional back-compat)", async () => {
    const url = await resolveManagedOrLegacyUrl({ attachmentUrl: LEGACY_URL, attachmentFileId: null });
    expect(url).toBe(LEGACY_URL);
  });

  it("returns null when neither a managed file nor a legacy URL exists", async () => {
    const url = await resolveManagedOrLegacyUrl({ attachmentUrl: null, attachmentFileId: null });
    expect(url).toBeNull();
  });

  it("returns null (not a broken reference) when attachmentFileId points at a StoredFile that no longer resolves", async () => {
    const url = await resolveManagedOrLegacyFileUrl(null, "does-not-exist");
    expect(url).toBeNull();
  });

  it("never exposes the raw storage key — the resolved reference is always a URL, not a bare key", async () => {
    const url = await resolveManagedOrLegacyFileUrl(null, "file-1");
    expect(url).not.toBe(RAW_STORAGE_KEY);
    expect(url).toMatch(/^memory:\/\//); // this test env's stand-in for a signed/public production URL
  });

  it("resolves a homework object AND every one of its submissions in one pass (withResolvedAttachments)", async () => {
    const homework = {
      attachmentUrl: null,
      attachmentFileId: "file-1",
      submissions: [
        { id: "sub-managed", attachmentUrl: null, attachmentFileId: "file-1" },
        { id: "sub-legacy", attachmentUrl: LEGACY_URL, attachmentFileId: null },
        { id: "sub-none", attachmentUrl: null, attachmentFileId: null },
      ],
    };

    const resolved = await withResolvedAttachments(homework);

    expect(resolved.attachmentUrl).toBe(`memory://${RAW_STORAGE_KEY}`);
    expect((resolved.submissions[0] as { attachmentUrl: string | null }).attachmentUrl).toBe(`memory://${RAW_STORAGE_KEY}`);
    expect((resolved.submissions[1] as { attachmentUrl: string | null }).attachmentUrl).toBe(LEGACY_URL);
    expect((resolved.submissions[2] as { attachmentUrl: string | null }).attachmentUrl).toBeNull();

    // Same shared helper, same result regardless of which route calls it —
    // this is the "consistent response rule" the closure pass required.
    const submissionResolvedIndividually = await resolveManagedOrLegacyUrl(homework.submissions[0]);
    expect(submissionResolvedIndividually).toBe((resolved.submissions[0] as { attachmentUrl: string | null }).attachmentUrl);
  });
});

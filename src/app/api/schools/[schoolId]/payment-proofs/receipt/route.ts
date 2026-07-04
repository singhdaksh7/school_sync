import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchoolForBilling, sessionRole } from "@/lib/tenant";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";

// Managed upload for a SaaS billing payment-proof receipt. This is the
// billing-recovery path (canAccessSchoolForBilling), NOT the FEES feature, and
// is intentionally status-EXEMPT so a suspended/expired school can still
// upload the proof that gets it reinstated.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchoolForBilling(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const upload = await readUploadedFile(req);
  if (!upload) return NextResponse.json({ error: "A receipt file is required" }, { status: 400 });

  const result = await uploadManagedFile({
    category: "PAYMENT_PROOF",
    schoolId,
    originalFilename: upload.filename,
    declaredContentType: upload.declaredContentType,
    bytes: upload.bytes,
    uploader: { type: "USER", id: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const url = await resolveDownloadUrl(result.file);
  return NextResponse.json({ file: { id: result.file.id, url, contentType: result.file.contentType } }, { status: 201 });
}

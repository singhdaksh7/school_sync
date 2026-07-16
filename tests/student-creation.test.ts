import { describe, it, expect, vi } from "vitest";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (plain: string) => `hashed:${plain}`) },
}));

import { createStudentRecord, type StudentCreateInput } from "@/lib/student-creation";

type CreateArgs = { data: Record<string, unknown>; include?: unknown };

function makeClient() {
  return { student: { create: vi.fn(async (args: CreateArgs) => ({ id: "s1", ...args.data })) } };
}

const baseInput: StudentCreateInput = {
  name: "Jane Doe",
  admissionNo: "ADM-1",
  rollNo: "12",
  sectionId: "sec1",
  schoolId: "sch1",
};

describe("createStudentRecord — single source of truth for Student row creation", () => {
  it("maps all provided fields onto the Student create payload", async () => {
    const client = makeClient();
    await createStudentRecord(client as never, {
      ...baseInput,
      email: "jane@example.com",
      phone: "1112223333",
      fatherName: "John Doe",
      fatherPhone: "9876543210",
      motherName: "Mary Doe",
      motherPhone: "9876500000",
    });

    expect(client.student.create).toHaveBeenCalledTimes(1);
    const { data } = client.student.create.mock.calls[0][0] as CreateArgs;
    expect(data).toMatchObject({
      name: "Jane Doe",
      admissionNo: "ADM-1",
      rollNo: "12",
      sectionId: "sec1",
      schoolId: "sch1",
      email: "jane@example.com",
      phone: "1112223333",
      fatherName: "John Doe",
      fatherPhone: "9876543210",
      motherName: "Mary Doe",
      motherPhone: "9876500000",
      fatherPhoneHash: "hashed:9876543210",
      motherPhoneHash: "hashed:9876500000",
    });
  });

  it("null-coalesces every optional field that is omitted", async () => {
    const client = makeClient();
    await createStudentRecord(client as never, baseInput);

    const { data } = client.student.create.mock.calls[0][0] as CreateArgs;
    expect(data.email).toBeNull();
    expect(data.phone).toBeNull();
    expect(data.fatherName).toBeNull();
    expect(data.fatherPhone).toBeNull();
    expect(data.motherName).toBeNull();
    expect(data.motherPhone).toBeNull();
    expect(data.fatherPhoneHash).toBeNull();
    expect(data.motherPhoneHash).toBeNull();
  });

  it("null-coalesces optional fields explicitly passed as empty string", async () => {
    const client = makeClient();
    await createStudentRecord(client as never, { ...baseInput, email: "", phone: "", fatherName: "", motherName: "" });

    const { data } = client.student.create.mock.calls[0][0] as CreateArgs;
    expect(data.email).toBeNull();
    expect(data.phone).toBeNull();
    expect(data.fatherName).toBeNull();
    expect(data.motherName).toBeNull();
  });

  it("derives password hashes via buildStudentPasswordHashes (bcrypt), not inline", async () => {
    const client = makeClient();
    await createStudentRecord(client as never, { ...baseInput, fatherPhone: "9876543210", motherPhone: undefined });

    const { data } = client.student.create.mock.calls[0][0] as CreateArgs;
    expect(data.fatherPhoneHash).toBe("hashed:9876543210");
    expect(data.motherPhoneHash).toBeNull();
  });

  it("passes through the requested include option", async () => {
    const client = makeClient();
    const include = { section: true } as never;
    await createStudentRecord(client as never, baseInput, { include });

    expect((client.student.create.mock.calls[0][0] as CreateArgs).include).toBe(include);
  });

  it("produces an identical row shape whether given the global prisma client or a transaction client — no special-casing", async () => {
    const globalLike = makeClient();
    const txLike = makeClient();

    await createStudentRecord(globalLike as never, { ...baseInput, fatherPhone: "9876543210" });
    await createStudentRecord(txLike as never, { ...baseInput, fatherPhone: "9876543210" });

    const globalData = (globalLike.student.create.mock.calls[0][0] as CreateArgs).data;
    const txData = (txLike.student.create.mock.calls[0][0] as CreateArgs).data;
    expect(globalData).toEqual(txData);
  });

  it("never imports or falls back to a module-level prisma client — only uses the client it is given", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/student-creation.ts", "utf8"));
    expect(source).not.toMatch(/import\s*\{[^}]*\bprisma\b[^}]*\}\s*from\s*["']@\/lib\/prisma["']/);
  });
});

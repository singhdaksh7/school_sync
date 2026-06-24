import bcrypt from "bcryptjs";

/**
 * A student's login password is their father's or mother's phone number —
 * there is no separately-set password. Re-derive both hashes whenever either
 * phone number is created or changed, so a stale number stops working as a
 * password automatically once it's edited.
 */
export async function buildStudentPasswordHashes(
  fatherPhone: string | null | undefined,
  motherPhone: string | null | undefined
) {
  const trimmedFather = typeof fatherPhone === "string" ? fatherPhone.trim() : "";
  const trimmedMother = typeof motherPhone === "string" ? motherPhone.trim() : "";
  return {
    fatherPhoneHash: trimmedFather ? await bcrypt.hash(trimmedFather, 10) : null,
    motherPhoneHash: trimmedMother ? await bcrypt.hash(trimmedMother, 10) : null,
  };
}

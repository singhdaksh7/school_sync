// API routes return plain English error strings (see e.g.
// src/app/api/schools/[schoolId]/students/route.ts). Re-architecting every
// route to return error codes is out of scope here — instead map the known,
// high-frequency messages to translation keys and fall back to the raw
// message for anything unmapped (still in English, but never breaks).
const KNOWN_MESSAGES: Record<string, string> = {
  Unauthorized: "apiErrors.unauthorized",
  Forbidden: "apiErrors.forbidden",
  "Not found": "apiErrors.notFound",
  "Internal server error": "apiErrors.internalServerError",
  "Invalid credentials": "apiErrors.invalidCredentials",
  "Teacher not found": "apiErrors.teacherNotFound",
  "Student not found": "apiErrors.studentNotFound",
  "School not found": "apiErrors.schoolNotFound",
  "Section not found in this school": "apiErrors.sectionNotFound",
  "Class not found in this school": "apiErrors.classNotFound",
  "Admission number already exists in this school": "apiErrors.duplicateAdmissionNo",
  "Roll number already exists": "apiErrors.duplicateRollNo",
  "A student with these details already exists": "apiErrors.duplicateStudent",
  "Father Phone or Mother Phone is required so the student can log in": "apiErrors.parentPhoneRequired",
  "No account found with that admission number.": "auth.noAccountWithAdmissionNo",
  "Incorrect password.": "auth.incorrectPassword",
};

/** Looks up a known API error string and translates it; unmapped messages pass through untranslated. */
export function translateApiError(message: string, t: (key: string) => string): string {
  const key = KNOWN_MESSAGES[message];
  return key ? t(key) : message;
}

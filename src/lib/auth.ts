import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authConfig } from "@/lib/auth.config";
import { staffAuthorize, founderAuthorize, studentAuthorize } from "@/lib/auth-providers";

// The actual authorize() logic (identity resolution, rate limiting, Founder/
// staff separation, error translation) lives in src/lib/auth-providers.ts —
// see that file for why, and tests/auth-providers.test.ts for the tests that
// exercise these exact functions at the provider boundary.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Owner / Admin / Vice Principal / Teacher — the single school-staff web
    // login used by the unified /login page.
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: staffAuthorize,
    }),
    // Founder-only web login used exclusively by /founder/login.
    CredentialsProvider({
      id: "founder-credentials",
      name: "founder-credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: founderAuthorize,
    }),
    // Student web login used by the unified /login page when the typed
    // identifier has no "@".
    CredentialsProvider({
      id: "student-credentials",
      name: "student-credentials",
      credentials: {
        identifier: { label: "Admission Number or Student ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: studentAuthorize,
    }),
  ],
});

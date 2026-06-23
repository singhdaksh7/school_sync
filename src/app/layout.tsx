import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import AuthSessionProvider from "@/components/providers/SessionProvider";
import ThemeProvider from "@/components/providers/ThemeProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { isLocale } from "@/lib/i18n/locales";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SchoolSync — School Management Platform",
  description: "Manage your school's teachers, students, classes, and attendance in one place.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("lang")?.value;
  const initialLocale = isLocale(cookieLocale) ? cookieLocale : "en";

  return (
    <html lang={initialLocale} className="h-full" suppressHydrationWarning>
      <body className={`${inter.className} h-full antialiased bg-background`}>
        <ThemeProvider>
          <LanguageProvider initialLocale={initialLocale}>
            <AuthSessionProvider>{children}</AuthSessionProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

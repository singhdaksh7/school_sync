import en from "@locales/en.json";
import hi from "@locales/hi.json";

export type Locale = "en" | "hi";

export const defaultLocale: Locale = "en";

export const locales: Record<Locale, unknown> = { en, hi };

export const localeNames: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "hi";
}

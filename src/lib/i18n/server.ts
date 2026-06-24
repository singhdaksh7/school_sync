import { cookies } from "next/headers";
import { defaultLocale, isLocale, locales, type Locale } from "./locales";

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("lang")?.value;
  return isLocale(cookieLocale) ? cookieLocale : defaultLocale;
}

/** Server-component counterpart to useTranslation() — same dictionary, reads the `lang` cookie directly instead of React context. */
export async function getServerTranslation() {
  const locale = await getServerLocale();
  const t = (key: string, vars?: Record<string, string | number>) => {
    const value = getByPath(locales[locale], key) ?? getByPath(locales[defaultLocale], key);
    if (typeof value !== "string") return key;
    return interpolate(value, vars);
  };
  return { locale, t };
}

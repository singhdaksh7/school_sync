import { describe, it, expect } from "vitest";
import en from "@locales/en.json";
import hi from "@locales/hi.json";

function keys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...keys(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

describe("library locale parity (en vs hi)", () => {
  it("has a top-level library block in both locales", () => {
    expect((en as Record<string, unknown>).library).toBeDefined();
    expect((hi as Record<string, unknown>).library).toBeDefined();
  });

  it("has identical nested key paths under library", () => {
    const enKeys = keys((en as Record<string, unknown>).library).sort();
    const hiKeys = keys((hi as Record<string, unknown>).library).sort();
    expect(hiKeys).toEqual(enKeys);
  });

  it("registers a nav.library entry in both locales", () => {
    expect((en as { nav: Record<string, string> }).nav.library).toBeTruthy();
    expect((hi as { nav: Record<string, string> }).nav.library).toBeTruthy();
  });

  it("uses different (translated) values, not copied English", () => {
    const enLib = (en as { library: { title: string } }).library.title;
    const hiLib = (hi as { library: { title: string } }).library.title;
    expect(enLib).not.toBe(hiLib);
  });
});

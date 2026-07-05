import { describe, it, expect } from "vitest";
import { parseCSV } from "@/lib/csv-parse";

describe("parseCSV", () => {
  it("parses a simple CSV with a header row", () => {
    const csv = "name,email\nJohn Doe,john@example.com\n";
    expect(parseCSV(csv)).toEqual([{ name: "John Doe", email: "john@example.com" }]);
  });

  it("handles a quoted field containing a comma without shifting later columns", () => {
    const csv = 'name,city,phone\n"Doe, John",Delhi,9876543210\n';
    expect(parseCSV(csv)).toEqual([{ name: "Doe, John", city: "Delhi", phone: "9876543210" }]);
  });

  it("handles escaped double quotes inside a quoted field", () => {
    const csv = 'name,note\n"Ann ""Annie"" Lee",vip\n';
    expect(parseCSV(csv)).toEqual([{ name: 'Ann "Annie" Lee', note: "vip" }]);
  });

  it("handles CRLF line endings", () => {
    const csv = "name,email\r\nJohn,john@x.com\r\n";
    expect(parseCSV(csv)).toEqual([{ name: "John", email: "john@x.com" }]);
  });

  it("handles a UTF-8 BOM at the start of the file", () => {
    const csv = "﻿name,email\nJohn,john@x.com\n";
    expect(parseCSV(csv)).toEqual([{ name: "John", email: "john@x.com" }]);
  });

  it("preserves empty trailing fields", () => {
    const csv = "name,phone,notes\nJohn,,\n";
    expect(parseCSV(csv)).toEqual([{ name: "John", phone: "", notes: "" }]);
  });

  it("normalizeHeaderWhitespace strips spaces from header names", () => {
    const csv = "Father Phone,Mother Phone\n123,456\n";
    expect(parseCSV(csv, { normalizeHeaderWhitespace: true })).toEqual([{ fatherphone: "123", motherphone: "456" }]);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCSV("name,email\n")).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("ignores a trailing blank line at end of file", () => {
    const csv = "name,email\nJohn,john@x.com\n\n";
    expect(parseCSV(csv)).toEqual([{ name: "John", email: "john@x.com" }]);
  });
});

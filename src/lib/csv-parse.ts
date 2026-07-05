/**
 * Minimal RFC4180-aware CSV parser (client + server safe, no dependencies).
 *
 * The naive `line.split(",")` approach previously used here breaks on any
 * quoted field containing a comma — which Excel/Sheets add automatically for
 * values like `"Doe, John"` or a comma-formatted number — silently shifting
 * every subsequent column on that row and corrupting the import. This parses
 * character-by-character so quoted commas, escaped quotes (`""`), and
 * embedded newlines inside a quoted field are all handled correctly.
 */

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank rows (e.g. a trailing newline at end of file).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Parses a CSV file's text into header-keyed rows. Headers are lowercased
 * and trimmed; pass `normalizeHeaderWhitespace: true` to also strip internal
 * whitespace (for header conventions like "Father Phone" -> "fatherphone").
 */
export function parseCSV(text: string, opts: { normalizeHeaderWhitespace?: boolean } = {}): Record<string, string>[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => {
    const normalized = h.trim().toLowerCase();
    return opts.normalizeHeaderWhitespace ? normalized.replace(/\s+/g, "") : normalized;
  });

  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (values[i] ?? "").trim();
    });
    return record;
  });
}

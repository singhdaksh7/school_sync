/**
 * Minimal dependency-free, serverless-safe multi-page PDF text layout engine.
 *
 * The repository intentionally has no PDF library dependency; documents are
 * emitted as raw PDF. The previous generators wrote every line onto ONE page
 * with fixed offsets, so long report cards / receipts clipped off the page. This
 * engine lays lines out top-to-bottom, wraps long text to the page width, and
 * starts a new page deterministically when vertical space runs out — so content
 * is never clipped regardless of subject count or name length.
 *
 * Fonts: uses the PDF built-in Helvetica (WinAnsi) which needs no embedding and
 * renders reliably on any server. The ₹ glyph is NOT in WinAnsi, so money is
 * rendered as "Rs." by callers (see receipt/report-card generators).
 */

export type PdfLine = {
  text: string;
  /** Font size in points (default 10). */
  size?: number;
  /** Extra vertical gap (points) before this line, e.g. to separate sections. */
  gapBefore?: number;
};

export type PdfDocOptions = {
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  lineHeight?: number;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Approximate character capacity for a line at a given font size and width. */
function maxCharsForWidth(usableWidth: number, size: number): number {
  // Helvetica average glyph advance ≈ 0.5 em; keep a small safety margin.
  return Math.max(8, Math.floor(usableWidth / (size * 0.5)));
}

/** Greedy word-wrap; hard-splits tokens longer than the line capacity. */
export function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) { out.push(current); current = ""; }
      for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

/**
 * Renders lines into a paginated PDF Buffer. Returns valid multi-page PDF bytes
 * with a correct xref table.
 */
export function renderTextPdf(lines: PdfLine[], opts: PdfDocOptions = {}): Buffer {
  const pageWidth = opts.pageWidth ?? 595; // A4 portrait
  const pageHeight = opts.pageHeight ?? 842;
  const margin = opts.margin ?? 54;
  const lineHeight = opts.lineHeight ?? 16;
  const usableWidth = pageWidth - margin * 2;
  const bottom = margin;
  const top = pageHeight - margin;

  // ── Lay out into pages ─────────────────────────────────────────────────────
  type Placed = { text: string; size: number; y: number };
  const pages: Placed[][] = [];
  let current: Placed[] = [];
  let y = top;

  const pushPage = () => {
    pages.push(current);
    current = [];
    y = top;
  };

  for (const line of lines) {
    const size = line.size ?? 10;
    if (line.gapBefore) y -= line.gapBefore;
    const wrapped = wrapText(line.text ?? "", maxCharsForWidth(usableWidth, size));
    for (const piece of wrapped) {
      if (y - lineHeight < bottom) pushPage();
      current.push({ text: piece, size, y });
      y -= lineHeight;
    }
  }
  pushPage();
  if (pages.length === 0) pages.push([]);

  // ── Build content streams (absolute positioning per glyph run) ──────────────
  const contentStreams = pages.map((placed) => {
    const ops: string[] = ["BT", "/F1 10 Tf"];
    let lastSize = 10;
    for (const item of placed) {
      if (item.size !== lastSize) {
        ops.push(`/F1 ${item.size} Tf`);
        lastSize = item.size;
      }
      ops.push(`1 0 0 1 ${margin} ${item.y} Tm`);
      ops.push(`(${escapePdfText(item.text)}) Tj`);
    }
    ops.push("ET");
    return ops.join("\n");
  });

  // ── Assemble objects ────────────────────────────────────────────────────────
  // 1: Catalog, 2: Pages, 3: Font, then per page: Page obj + Contents obj.
  const pageObjNumbers: number[] = [];
  const objects: string[] = [];
  objects.push(""); // placeholder for obj 1 (Catalog) — filled after we know kids
  objects.push(""); // placeholder for obj 2 (Pages)
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // obj 3

  let nextObj = 4;
  const pageEntries: { pageObj: number; contentObj: number; stream: string }[] = [];
  for (const stream of contentStreams) {
    const contentObj = nextObj++;
    const pageObj = nextObj++;
    pageObjNumbers.push(pageObj);
    pageEntries.push({ pageObj, contentObj, stream });
  }

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjNumbers.length} >>`;

  // Content + page objects must be emitted in object-number order (4,5,6,...).
  const ordered: { num: number; body: string }[] = [];
  for (const entry of pageEntries) {
    ordered.push({
      num: entry.contentObj,
      body: `<< /Length ${Buffer.byteLength(entry.stream, "utf8")} >>\nstream\n${entry.stream}\nendstream`,
    });
    ordered.push({
      num: entry.pageObj,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${entry.contentObj} 0 R >>`,
    });
  }

  const allObjects: string[] = [objects[0], objects[1], objects[2]];
  ordered.sort((a, b) => a.num - b.num);
  for (const o of ordered) allObjects[o.num - 1] = o.body;

  // ── Serialize with a correct xref table ─────────────────────────────────────
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  allObjects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${allObjects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${allObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

/** Number of pages a set of lines will paginate into (for tests/telemetry). */
export function countPdfPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

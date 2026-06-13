type ReceiptPdfInput = {
  schoolName: string;
  studentName: string;
  classSection: string;
  feeTitle: string;
  amount: string;
  paymentMethod: string;
  receiptNumber: string;
  paidAt: string;
  gatewayPaymentId?: string | null;
};

export function generateReceiptPdf(input: ReceiptPdfInput) {
  const lines = [
    input.schoolName,
    "Fee Payment Receipt",
    "",
    `Receipt No: ${input.receiptNumber}`,
    `Date/Time: ${input.paidAt}`,
    "",
    `Student: ${input.studentName}`,
    `Class/Section: ${input.classSection}`,
    `Fee: ${input.feeTitle}`,
    `Amount: ${input.amount}`,
    `Payment Method: ${input.paymentMethod}`,
    ...(input.gatewayPaymentId ? [`Gateway Payment ID: ${input.gatewayPaymentId}`] : []),
    "",
    "This is a computer-generated receipt.",
  ];

  const content = [
    "BT",
    "/F1 18 Tf",
    "72 760 Td",
    `(${escapePdfText(lines[0])}) Tj`,
    "/F1 14 Tf",
    "0 -28 Td",
    `(${escapePdfText(lines[1])}) Tj`,
    "/F1 11 Tf",
    ...lines.slice(2).map((line) => `0 -22 Td\n(${escapePdfText(line)}) Tj`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

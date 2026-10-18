import PDFDocument from "pdfkit";

/**
 * Turns an agent's plain-markdown output into a real PDF file, as the first
 * step toward "output yang menghasilkan dokumen tersimpan di Google Drive" -
 * Drive needs an actual file to upload, not a markdown string.
 *
 * Deliberately a hand-rolled line-by-line renderer with PDFKit rather than a
 * headless-browser/HTML route (Puppeteer): the worker/API containers run on
 * node:20-slim with no Chromium, and agent output here is simple report-style
 * markdown (headings, paragraphs, bullet lists, bold text, code blocks) - a
 * full HTML+CSS layout engine would be a lot of extra image/runtime weight
 * for formatting this content doesn't need.
 */
export async function markdownToPdfBuffer(title: string, markdown: string): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 56, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(18).text(title, { align: "left" });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#666666")
    .text(`Dihasilkan ${new Date().toLocaleString("id-ID")}`, { align: "left" })
    .fillColor("#000000");
  doc.moveDown(1);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#dddddd")
    .stroke();
  doc.moveDown(1);

  let inCodeBlock = false;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      doc.font("Courier").fontSize(9).fillColor("#111111").text(line || " ");
      continue;
    }

    if (!line.trim()) {
      doc.moveDown(0.4);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      doc.moveDown(0.5);
      doc
        .font("Helvetica-Bold")
        .fontSize(level === 1 ? 16 : level === 2 ? 14 : 12)
        .fillColor("#000000")
        .text(text);
      doc.moveDown(0.2);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      doc.font("Helvetica").fontSize(10.5).text(`•  ${stripInlineMarkdown(bullet[1])}`, { indent: 14 });
      continue;
    }

    const numbered = /^(\d+)\.\s+(.*)$/.exec(line.trim());
    if (numbered) {
      doc.font("Helvetica").fontSize(10.5).text(`${numbered[1]}.  ${stripInlineMarkdown(numbered[2])}`, { indent: 14 });
      continue;
    }

    doc.font("Helvetica").fontSize(10.5).text(stripInlineMarkdown(line));
  }

  doc.end();
  return done;
}

/** Drops markdown emphasis markers for a plain-text pass (bold/italic render as plain text, not styled runs). */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1");
}

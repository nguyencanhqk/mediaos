/**
 * S15-PAYROLL-BE-5B — đọc LẠI PDF sinh ra (DECISIONS-14 §6.2): trích văn bản bằng `pdfjs-dist` (devDependency,
 * chỉ test) để đối chiếu CHUỖI CÓ DẤU, không chỉ kiểm glyph. Kèm dấu hiệu font nhúng để ca test phân biệt
 * được «Roboto nhúng» với «rơi về font chuẩn».
 */

export interface PdfInspection {
  /** Văn bản mọi trang, nối bằng khoảng trắng / xuống dòng. */
  text: string;
  pageCount: number;
  /** Có ít nhất một chương trình font TrueType nhúng (`/FontFile2`). */
  hasEmbeddedTrueType: boolean;
  /** Có BaseFont Roboto dạng subset (`/ABCDEF+Roboto…`). */
  hasEmbeddedRoboto: boolean;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const raw = Buffer.from(bytes).toString("latin1");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  try {
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return {
      text: pages.join("\n"),
      pageCount: doc.numPages,
      hasEmbeddedTrueType: raw.includes("/FontFile2"),
      hasEmbeddedRoboto: /\/BaseFont\s*\/[A-Z]{6}\+Roboto/.test(raw),
    };
  } finally {
    await doc.destroy();
  }
}

/** Gộp khoảng trắng — pdfjs có thể tách một dòng thành nhiều mảnh. */
export function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

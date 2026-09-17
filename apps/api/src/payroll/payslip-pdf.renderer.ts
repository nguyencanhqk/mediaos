import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { PAYSLIP_PDF_FONT, type PdfDocDefinition } from "./payslip-pdf.document";

/**
 * S15-PAYROLL-BE-5B — renderer pdfmake 0.3 (DECISIONS-14 §4).
 *
 * - Font **NHÚNG**: 4 tệp Roboto kèm gói `pdfmake` được đọc MỘT lần vào virtual-fs của pdfmake; bộ font
 *   khai theo TÊN trong vfs ⇒ pdfmake không bao giờ mở đường dẫn đĩa (§4.2 — rơi về font chuẩn là mất dấu
 *   tiếng Việt im lặng).
 * - `setUrlAccessPolicy(() => false)` + `setLocalAccessPolicy(() => false)`: tài liệu phiếu lương không có
 *   ảnh/tệp đính kèm, nên mọi yêu cầu tài nguyên ngoài đều là lỗi — chặn, không cho tải.
 * - pdfmake là singleton cấp module ⇒ cấu hình một lần (`ensureConfigured`), idempotent.
 */

interface PdfMakeOutput {
  getBuffer(): Promise<Buffer>;
}

interface PdfMakeServer {
  virtualfs: { writeFileSync(name: string, content: Buffer): void };
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(doc: PdfDocDefinition, options?: Record<string, unknown>): PdfMakeOutput;
}

const FONT_FILES = {
  normal: "Roboto-Regular.ttf",
  bold: "Roboto-Medium.ttf",
  italics: "Roboto-Italic.ttf",
  bolditalics: "Roboto-MediumItalic.ttf",
} as const;

// pdfmake 0.3 là CJS singleton không kèm kiểu ⇒ nạp qua createRequire (khuôn `config/swagger.ts`;
// __filename có sẵn vì tsconfig module=commonjs).
const loadCjs = createRequire(__filename);

let configured: PdfMakeServer | null = null;

function ensureConfigured(): PdfMakeServer {
  if (configured) return configured;
  const pdfmake = loadCjs("pdfmake") as PdfMakeServer;
  const fontDir = join(dirname(loadCjs.resolve("pdfmake/package.json")), "fonts", "Roboto");
  const vfsNames: Record<string, string> = {};
  for (const [style, file] of Object.entries(FONT_FILES)) {
    const vfsName = `payslip-${file}`;
    pdfmake.virtualfs.writeFileSync(vfsName, readFileSync(join(fontDir, file)));
    vfsNames[style] = vfsName;
  }
  pdfmake.addFonts({ [PAYSLIP_PDF_FONT]: vfsNames });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
  configured = pdfmake;
  return pdfmake;
}

@Injectable()
export class PayslipPdfRenderer {
  async render(doc: PdfDocDefinition): Promise<Buffer> {
    const pdfmake = ensureConfigured();
    return pdfmake.createPdf(doc).getBuffer();
  }
}

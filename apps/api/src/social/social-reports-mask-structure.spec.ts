import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-RESNOTEMASK-1 — ràng buộc CẤU TRÚC «một vị từ» của DTO báo cáo (plan §4.1, §6 S-1, mutant ★6).
 *
 * Int-spec chỉ đo hành vi HTTP: một biểu thức `isCompany(…)` THỨ HAI trong `toReportDto` cho cùng kết
 * quả ở mọi fixture hiện có nên không ca nào bắt được — nhưng nó là nguồn luật thứ hai, sẽ trôi khi một
 * bên được sửa. Luật: thân `toReportDto` KHÔNG tự tính vị từ; mọi trường bị che (`reporter`,
 * `resolutionNote`) dùng LẠI tham số `revealReporter` do call-site tính từ `isCompany(actor.routeScope)`.
 * Khuôn đọc nguồn: `social-avatar-sign-structure.spec.ts`.
 */

const SERVICE_FILE = join(__dirname, "social-reports.service.ts");

/** Bỏ comment, GIỮ dấu xuống dòng — luật nói về CODE, không về docblock giải thích luật. */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Thân hàm `toReportDto` — từ `{` đầu tiên sau chữ ký tới `}` khớp cặp. */
function toReportDtoBody(): string {
  const text = stripComments(readFileSync(SERVICE_FILE, "utf8"));
  const sig = text.indexOf("function toReportDto(");
  expect(
    sig,
    "không tìm thấy `function toReportDto(` — đổi tên thì cập nhật spec này",
  ).toBeGreaterThan(-1);
  const open = text.indexOf("{", text.indexOf(")", sig));
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error("thân `toReportDto` không khớp cặp ngoặc");
}

describe("S16-SOCIAL-RESNOTEMASK-1 — toReportDto: một vị từ", () => {
  it("S-1a: thân toReportDto KHÔNG tự gọi isCompany (vị từ chỉ tính ở call-site)", () => {
    expect(toReportDtoBody()).not.toMatch(/\bisCompany\s*\(/);
  });

  it("S-1b: chữ ký có tham số `revealReporter: boolean` (không mặc định)", () => {
    const text = stripComments(readFileSync(SERVICE_FILE, "utf8"));
    expect(text).toMatch(/function toReportDto\([^)]*\brevealReporter: boolean[,)]/);
  });

  it.each(["reporter", "resolutionNote"])(
    "S-1c: trường `%s` của DTO dùng LẠI tham số revealReporter",
    (field) => {
      const body = toReportDtoBody();
      const lines = body.split("\n");
      const idx = lines.findIndex((l) => new RegExp(`^\\s*${field}:`).test(l));
      expect(idx, `không thấy dòng \`${field}:\` trong toReportDto`).toBeGreaterThan(-1);
      // Biểu thức của trường có thể xuống dòng (`reporter: revealReporter\n ? … : null`) — lấy tới `,` cuối.
      const expr = lines.slice(idx, idx + 3).join(" ");
      expect(expr).toMatch(new RegExp(`^\\s*${field}:\\s*revealReporter\\b`));
    },
  );
});

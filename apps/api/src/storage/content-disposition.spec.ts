/**
 * S16-SOCIAL-FILEDISPOSITION-1 L1 — dựng `Content-Disposition: attachment` (hàm thuần, toàn phần).
 *
 * Ca P3 · P4 của plan §4.
 */
import { describe, expect, it } from "vitest";
import { buildAttachmentDisposition } from "./content-disposition";

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const MAX_HEADER_CHARS = 700;

/**
 * BẢN CHÉP parser tên tệp phía FE — nguồn: `packages/web-core/src/lib/api-client.ts:597-609`
 * (`parseContentDispositionFilename`, chép ngày 08/10/2026). FE đổi parser ⇒ chép lại bản mới vào đây;
 * ca P4 tồn tại để hai phía không trôi khỏi nhau.
 */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return extended[1];
    }
  }
  const plain = /filename=["']?([^"';\r\n]+)["']?/i.exec(header);
  return plain?.[1] ?? null;
}

/** 9 tên của phép chạy thử U3: [nhãn, tên thô, tên kỳ vọng sau khi làm sạch]. */
const NAME_CASES: ReadonlyArray<readonly [string, string, string]> = [
  ["tiếng Việt", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf"],
  ["nháy kép", 'a "b" c.docx', 'a "b" c.docx'],
  ["chấm phẩy + phần trăm", "x;y%20z%.txt", "x;y%20z%.txt"],
  ["CR/LF", "dong1\r\nX-Khac: a=b.pdf", "dong1X-Khac: a=b.pdf"],
  ["gạch chéo", "..\\..\\thu-muc/tep", ".._.._thu-muc_tep"],
  ["ký tự đảo chiều", "inv\u202Efdp.exe", "invfdp.exe"],
  ["nháy đơn + ngoặc + sao", "it's (1)*.png", "it's (1)*.png"],
  ["rỗng", "", "download"],
  ["300 ký tự", `${"ă".repeat(300)}.xlsx`, `${"ă".repeat(87)}.xlsx`],
];

describe("buildAttachmentDisposition — P3", () => {
  it.each(NAME_CASES)("%s: đầu ra ASCII in được, không xuống dòng, ≤ 700 ký tự", (_label, raw) => {
    const header = buildAttachmentDisposition(raw);
    expect(header).toMatch(PRINTABLE_ASCII);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.length).toBeLessThanOrEqual(MAX_HEADER_CHARS);
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).toContain("; filename*=UTF-8''");
  });

  it("phần dự phòng trong nháy kép không chứa nháy kép / gạch chéo ngược / chấm phẩy / phần trăm", () => {
    for (const [, raw] of NAME_CASES) {
      const quoted = /^attachment; filename="([^"]*)"; filename\*=/.exec(
        buildAttachmentDisposition(raw),
      );
      expect(quoted, raw).not.toBeNull();
      expect(quoted?.[1]).not.toMatch(/["\\;%]/);
    }
  });

  it("emoji (ngoài BMP) vắt qua mốc 180 byte: KHÔNG ném, đầu ra ASCII, không cắt đôi ký tự", () => {
    const raw = `${"a".repeat(174)}😀😀.pdf`;
    const header = buildAttachmentDisposition(raw);
    expect(header).toMatch(PRINTABLE_ASCII);
    expect(parseContentDispositionFilename(header)).toBe(`${"a".repeat(174)}.pdf`);
  });

  it("surrogate lẻ: KHÔNG ném, đầu ra ASCII, rơi về tên download", () => {
    const header = buildAttachmentDisposition("a\uD83D.pdf");
    expect(header).toMatch(PRINTABLE_ASCII);
    expect(header).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
  });

  it("đầu vào không phải chuỗi lúc chạy (null / undefined): KHÔNG ném", () => {
    const loose = buildAttachmentDisposition as (rawName: unknown) => string;
    expect(loose(null)).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
    expect(loose(undefined)).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
  });

  it("tên chỉ gồm dấu chấm ⇒ download", () => {
    expect(parseContentDispositionFilename(buildAttachmentDisposition(".."))).toBe("download");
  });

  it("tên ASCII thường giữ nguyên", () => {
    expect(buildAttachmentDisposition("report-2026.pdf")).toBe(
      "attachment; filename=\"report-2026.pdf\"; filename*=UTF-8''report-2026.pdf",
    );
  });

  it("cắt theo byte UTF-8 vẫn giữ đuôi tệp", () => {
    const header = buildAttachmentDisposition(`${"x".repeat(400)}.docx`);
    expect(parseContentDispositionFilename(header)).toBe(`${"x".repeat(175)}.docx`);
  });
});

describe("buildAttachmentDisposition — P4 (đối chiếu parser FE)", () => {
  it.each(NAME_CASES)(
    "%s: parser FE đọc ngược ra đúng tên đã làm sạch",
    (_label, raw, expected) => {
      expect(parseContentDispositionFilename(buildAttachmentDisposition(raw))).toBe(expected);
    },
  );

  it("tên thô chứa chính chuỗi `filename*=` không đánh lừa parser FE", () => {
    const header = buildAttachmentDisposition("filename*=khac.pdf");
    expect(parseContentDispositionFilename(header)).toBe("filename*=khac.pdf");
  });
});

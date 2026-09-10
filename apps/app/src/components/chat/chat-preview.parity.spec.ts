/**
 * S17-CHAT-UX2-FE-1 — RATCHET: bản preview của FE phải nói CÙNG MỘT LUẬT với bản của BE.
 *
 * `apps/app` không import được `apps/api`, nên `chat-preview.ts` tồn tại hai bản. Hai bản LỆCH nhau
 * không làm gì đỏ: dòng phòng chỉ **nhảy chữ** mỗi lần refetch REST — 120 ký tự thành 118, hay một tin
 * `system` bỗng mất tiền tố. Không ai để ý cho tới khi có người báo "chat cứ chớp chớp".
 *
 * Ca này đọc file NGUỒN của BE và so LITERAL. Đỏ ở đây luôn nêu đích danh cả hai đường dẫn — người sửa
 * biết ngay phải đồng bộ chỗ nào, thay vì đi tìm một khác biệt không quan sát được.
 *
 * ⚠️ So literal chứ không so hành vi có chủ ý: chạy hàm của BE ở đây là import runtime NestJS vào một
 * test jsdom (nặng và giòn), còn viết lại đầu vào/đầu ra ở hai nơi thì chính bảng ca test lại là bản
 * sao thứ ba phải giữ đồng bộ bằng tay.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_PREVIEW_MAX_GRAPHEMES } from "./chat-preview";

/** `apps/app/src/components/chat` → `apps/api/src/chat`. */
const API_PREVIEW = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "api",
  "src",
  "chat",
  "chat-preview.ts",
);
const FE_PREVIEW = join(__dirname, "chat-preview.ts");

/**
 * ⚠️ **Bỏ dòng COMMENT trước khi so.** Cả hai file giải thích luật bằng chính những literal đang bị neo
 * ("KHÔNG đọc `attachments.length`", "không strip `\p{Cf}`"), nên một ratchet quét thô sẽ khớp phần
 * VĂN XUÔI và báo xanh/đỏ về thứ không chạy (memory `vitest-exclude-selfcheck-reads-comments`).
 *
 * Lọc theo DÒNG chứ không bóc comment tổng quát: hai file này viết block-comment kiểu `*` thụt đầu dòng
 * và **không** có `//` nào nằm trong chuỗi/regex, nên phép lọc này tất định. Thêm một URL vào file nguồn
 * thì phải xem lại chỗ này.
 */
function codeOnly(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t === "");
    })
    .join("\n");
}

const apiSource = codeOnly(readFileSync(API_PREVIEW, "utf8"));
const feSource = codeOnly(readFileSync(FE_PREVIEW, "utf8"));

describe("chat-preview · parity BE ↔ FE", () => {
  it("trần grapheme trùng nhau ở CẢ literal lẫn giá trị đã export", () => {
    expect(apiSource).toContain("export const CHAT_PREVIEW_MAX_GRAPHEMES = 120;");
    expect(feSource).toContain("export const CHAT_PREVIEW_MAX_GRAPHEMES = 120;");
    expect(CHAT_PREVIEW_MAX_GRAPHEMES).toBe(120);
  });

  it("regex strip ký tự điều khiển trùng NGUYÊN VĂN (gồm cả việc KHÔNG có \\p{Cf})", () => {
    const literal = "/[\\p{Cc}\\p{Zl}\\p{Zp}]+/gu";
    expect(apiSource).toContain(literal);
    expect(feSource).toContain(literal);
    // Vế phủ định là nửa quan trọng hơn: thêm `\p{Cf}` sẽ chẻ cụm emoji ZWJ thành ba emoji rời.
    expect(apiSource).not.toContain("\\p{Cf}]");
    expect(feSource).not.toContain("\\p{Cf}]");
  });

  it("chuỗi ép-một-dòng trùng nguyên văn (gom khoảng trắng rồi mới cắt hai đầu)", () => {
    const literal = '.replace(/\\s+/gu, " ").trim()';
    expect(apiSource).toContain(literal);
    expect(feSource).toContain(literal);
  });

  it("`Intl.Segmenter` cùng locale + cùng granularity", () => {
    const literal = 'new Intl.Segmenter("vi", { granularity: "grapheme" })';
    expect(apiSource).toContain(literal);
    expect(feSource).toContain(literal);
  });

  /**
   * Thứ tự nhánh LÀ hợp đồng (recalled → system → text → file → text-rỗng). Đảo hai nhánh đầu là để
   * nội dung tin đã thu hồi ra ngoài; đảo `text`/`file` là mất chữ của tin vừa có chữ vừa có tệp.
   */
  it("thứ tự 5 nhánh `kind` giống nhau ở hai bản", () => {
    const kinds = (source: string): string[] =>
      [...source.matchAll(/kind:\s*"(recalled|system|text|file)"/g)].map((m) => m[1]);
    const expected = ["recalled", "system", "text", "file", "text"];
    expect(kinds(apiSource)).toEqual(expected);
    expect(kinds(feSource)).toEqual(expected);
  });

  /**
   * Ratchet literal KHÔNG so được điều kiện guard — đó chính là lỗ mà ca này bịt. Bỏ tên biến nhận
   * (`row.` ở BE, `message.` ở FE) rồi so phần còn lại: cả hai phải kiểm ĐỦ HAI vế `null` + `undefined`.
   */
  it("guard `recalled` so ĐỦ hai vế ở cả hai bản (null VÀ undefined)", () => {
    for (const [name, source] of [
      ["api", apiSource],
      ["fe", feSource],
    ] as const) {
      expect(source, `${name} thiếu vế null`).toContain("recalledAt !== null");
      expect(source, `${name} thiếu vế undefined`).toContain("recalledAt !== undefined");
    }
  });

  it("cả hai bản đọc CỘT `attachmentCount`, không bản nào đọc `attachments.length`", () => {
    expect(apiSource).not.toContain("attachments.length");
    expect(feSource).not.toContain("attachments.length");
  });
});

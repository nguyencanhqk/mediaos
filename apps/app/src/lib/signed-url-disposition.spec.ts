/**
 * S16-SOCIAL-FILEOPENUX-1 (P-1) — đọc cách phục vụ mà SERVER đã ký vào URL (`response-content-disposition`).
 *
 * Server LUÔN đặt tham số này khi ký GET và tự kiểm URL trước khi trả (vắng · trùng · khác giá trị · tên khác
 * chữ thường ⇒ không trả URL). Bộ đọc của FE soi đúng các điều kiện đó: lệch bất kỳ điều nào ⇒ `unknown`
 * (caller giữ hành vi cũ — mở tab mới), KHÔNG đoán theo đuôi tệp hay đường dẫn.
 *
 * URL thử ghép từ `URLSearchParams` — không host thật, không chữ ký thật.
 */
import { describe, expect, it } from "vitest";
import { signedUrlDisposition } from "./signed-url-disposition";

const PARAM = "response-content-disposition";

function signed(pairs: ReadonlyArray<readonly [string, string]>, path = "/co/obj"): URL {
  const query = new URLSearchParams();
  for (const [key, value] of pairs) query.append(key, value);
  return new URL(`https://storage.example.test${path}?${query.toString()}`);
}

const ATTACHMENT_VALUE = `attachment; filename="a.pdf"; filename*=UTF-8''a.pdf`;

describe("signedUrlDisposition — tham số do server ký quyết định (P-1)", () => {
  it.each<[string, URL, "inline" | "attachment" | "unknown"]>([
    ["`inline`", signed([[PARAM, "inline"]]), "inline"],
    ["`attachment; filename=…`", signed([[PARAM, ATTACHMENT_VALUE]]), "attachment"],
    [
      "`Attachment; …` (khác hoa-thường ở GIÁ TRỊ)",
      signed([[PARAM, 'Attachment; filename="a.pdf"']]),
      "attachment",
    ],
    [
      "giá trị có khoảng trắng quanh token",
      signed([[PARAM, "  ATTACHMENT  ; filename=a.pdf"]]),
      "attachment",
    ],
    ["vắng tham số", signed([["X-Amz-Expires", "300"]]), "unknown"],
    [
      "tham số trùng 2 lần",
      signed([
        [PARAM, "inline"],
        [PARAM, "inline"],
      ]),
      "unknown",
    ],
    [
      "tên tham số viết hoa khác (không có bản chữ thường)",
      signed([["Response-Content-Disposition", "attachment"]]),
      "unknown",
    ],
    [
      "bản chữ thường + một biến thể hoa-thường khác",
      signed([
        [PARAM, "attachment"],
        ["RESPONSE-CONTENT-DISPOSITION", "inline"],
      ]),
      "unknown",
    ],
    [
      '`inline; filename="attachment.pdf"` (token đầu quyết định)',
      signed([[PARAM, 'inline; filename="attachment.pdf"']]),
      "inline",
    ],
    ["`attachmentx` (không phải token đúng)", signed([[PARAM, "attachmentx"]]), "unknown"],
    ["giá trị rỗng", signed([[PARAM, ""]]), "unknown"],
  ])("%s ⇒ %s", (_label, url, expected) => {
    expect(signedUrlDisposition(url)).toBe(expected);
  });

  it("mã hoá kiểu SigV4 (`%20`, `%3B`) đọc ra cùng kết quả với kiểu `+`", () => {
    const encoded = encodeURIComponent(ATTACHMENT_VALUE);
    const url = new URL(
      `https://storage.example.test/co/obj?${PARAM}=${encoded}&X-Amz-Expires=300`,
    );
    expect(signedUrlDisposition(url)).toBe("attachment");
  });

  it("KHÔNG đoán theo đuôi tệp / đường dẫn: `.pdf` không tham số ⇒ unknown; `.png` + attachment ⇒ attachment", () => {
    expect(signedUrlDisposition(signed([], "/co/bang-luong.pdf"))).toBe("unknown");
    expect(signedUrlDisposition(signed([[PARAM, ATTACHMENT_VALUE]], "/co/anh.png"))).toBe(
      "attachment",
    );
  });

  it("KHÔNG đọc `response-content-type`: kiểu PDF + disposition inline ⇒ inline", () => {
    const url = signed([
      ["response-content-type", "application/pdf"],
      [PARAM, "inline"],
    ]);
    expect(signedUrlDisposition(url)).toBe("inline");
  });
});

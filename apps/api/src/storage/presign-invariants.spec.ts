/**
 * S16-SOCIAL-FILEDISPOSITION-1 — tự kiểm URL đã ký (hàm thuần).
 *
 * Ca P5 của plan §4. URL ở đây là chuỗi dựng tay (host `.invalid`, chữ ký giả ngắn) — không ký thật, không mạng.
 * URL GET được so theo GIÁ TRỊ: cả kiểu trả lẫn disposition phải bằng đúng chuỗi server định ký, mỗi tham số
 * có mặt đúng một lần. Mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP cùng khung.
 */
import { describe, expect, it } from "vitest";
import {
  StoragePresignInvariantError,
  assertPresignedGetPinsServeDirectives,
  assertPresignedPutSignsContentType,
} from "./presign-invariants";

const BASE = "http://storage.invalid:9000/bucket/co/khoa";
const SIG = ["X-Amz-Signature", "00"].join("=");
const UNPARSEABLE = /URL không phân tích được/;

function putUrl(signedHeaders: string | null): string {
  const signed = signedHeaders === null ? "" : `&X-Amz-SignedHeaders=${signedHeaders}`;
  return `${BASE}?X-Amz-Expires=300${signed}&${SIG}`;
}

/** URL GET với các tham số cho trước (giá trị được percent-encode như lớp ký làm). */
function getUrl(params: ReadonlyArray<readonly [name: string, value: string]>): string {
  const query = params.map(([name, value]) => `&${name}=${encodeURIComponent(value)}`).join("");
  return `${BASE}?X-Amz-Expires=300${query}&${SIG}`;
}

const TYPE = "response-content-type";
const DISPOSITION = "response-content-disposition";

const PDF = {
  responseContentType: "application/pdf",
  responseContentDisposition: `attachment; filename="bao cao (1).pdf"; filename*=UTF-8''bao%20cao%20%281%29.pdf`,
};
const PNG = { responseContentType: "image/png", responseContentDisposition: "inline" };

describe("assertPresignedPutSignsContentType — P5", () => {
  it.each([
    ["thiếu content-type", putUrl("content-length%3Bhost")],
    ["không có tham số SignedHeaders", putUrl(null)],
    ["tên gần giống (x-content-type)", putUrl("content-length%3Bhost%3Bx-content-type")],
    [
      "tham số SignedHeaders lặp",
      `${putUrl("content-length%3Bcontent-type%3Bhost")}&X-Amz-SignedHeaders=host`,
    ],
    ["chuỗi không phải URL", "không phải url"],
    ["chuỗi rỗng", ""],
  ])("%s ⇒ ném StoragePresignInvariantError", (_label, url) => {
    expect(() => assertPresignedPutSignsContentType(url)).toThrow(StoragePresignInvariantError);
  });

  it.each([
    ["đủ (đã mã hoá dấu ;)", putUrl("content-length%3Bcontent-type%3Bhost")],
    ["đủ (dấu ; thô)", putUrl("content-length;content-type;host")],
  ])("%s ⇒ không ném", (_label, url) => {
    expect(() => assertPresignedPutSignsContentType(url)).not.toThrow();
  });

  it("URL không phân tích được ⇒ thông điệp nói đúng nguyên nhân; URL hợp lệ thiếu ràng buộc ⇒ thông điệp khác", () => {
    expect(() => assertPresignedPutSignsContentType("không phải url")).toThrow(UNPARSEABLE);
    expect(() => assertPresignedPutSignsContentType(putUrl("content-length%3Bhost"))).toThrow(
      /content-type không nằm trong các header đã ký/,
    );
    expect(() => assertPresignedPutSignsContentType(putUrl("content-length%3Bhost"))).not.toThrow(
      UNPARSEABLE,
    );
  });
});

describe("assertPresignedGetPinsServeDirectives — P5 (so GIÁ TRỊ)", () => {
  it.each([
    ["thiếu cả hai tham số", getUrl([]), PDF],
    ["thiếu response-content-type", getUrl([[DISPOSITION, PDF.responseContentDisposition]]), PDF],
    ["thiếu response-content-disposition", getUrl([[TYPE, PDF.responseContentType]]), PDF],
    [
      "thiếu response-content-disposition (loại hiển thị trực tiếp)",
      getUrl([[TYPE, "image/png"]]),
      PNG,
    ],
    [
      "response-content-type rỗng",
      getUrl([
        [TYPE, ""],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PDF,
    ],
    [
      "kiểu lệch",
      getUrl([
        [TYPE, "text/html"],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PDF,
    ],
    [
      "kiểu chỉ lệch hoa-thường",
      getUrl([
        [TYPE, "Application/PDF"],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PDF,
    ],
    [
      "disposition lệch (inline thay cho attachment)",
      getUrl([
        [TYPE, PDF.responseContentType],
        [DISPOSITION, "inline"],
      ]),
      PDF,
    ],
    [
      "disposition lệch (attachment thay cho inline)",
      getUrl([
        [TYPE, PNG.responseContentType],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PNG,
    ],
    [
      "disposition bị cắt cụt",
      getUrl([
        [TYPE, PDF.responseContentType],
        [DISPOSITION, PDF.responseContentDisposition.slice(0, -4)],
      ]),
      PDF,
    ],
    [
      "disposition rỗng",
      getUrl([
        [TYPE, PNG.responseContentType],
        [DISPOSITION, ""],
      ]),
      PNG,
    ],
    [
      "tham số kiểu lặp (cùng giá trị đúng)",
      getUrl([
        [TYPE, PDF.responseContentType],
        [TYPE, PDF.responseContentType],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PDF,
    ],
    [
      "tham số disposition lặp (đúng rồi tới khác)",
      getUrl([
        [TYPE, PNG.responseContentType],
        [DISPOSITION, "inline"],
        [DISPOSITION, "attachment"],
      ]),
      PNG,
    ],
    [
      "tham số disposition lặp khác hoa-thường ở TÊN",
      getUrl([
        [TYPE, PNG.responseContentType],
        [DISPOSITION, "inline"],
        ["Response-Content-Disposition", "attachment"],
      ]),
      PNG,
    ],
    ["chuỗi không phải URL", "không phải url", PDF],
  ])("TỪ CHỐI: %s ⇒ ném StoragePresignInvariantError", (_label, url, expected) => {
    expect(() => assertPresignedGetPinsServeDirectives(url, expected)).toThrow(
      StoragePresignInvariantError,
    );
  });

  it.each([
    [
      "loại tải xuống: kiểu + attachment đúng từng ký tự",
      getUrl([
        [TYPE, PDF.responseContentType],
        [DISPOSITION, PDF.responseContentDisposition],
      ]),
      PDF,
    ],
    [
      "loại hiển thị trực tiếp: kiểu + inline",
      getUrl([
        [TYPE, PNG.responseContentType],
        [DISPOSITION, PNG.responseContentDisposition],
      ]),
      PNG,
    ],
    [
      "thứ tự tham số đảo",
      getUrl([
        [DISPOSITION, PNG.responseContentDisposition],
        [TYPE, PNG.responseContentType],
      ]),
      PNG,
    ],
  ])("CHO PHÉP: %s ⇒ không ném", (_label, url, expected) => {
    expect(() => assertPresignedGetPinsServeDirectives(url, expected)).not.toThrow();
  });

  it("URL không phân tích được ⇒ thông điệp nói đúng nguyên nhân; thiếu tham số ⇒ thông điệp nêu tên tham số", () => {
    expect(() => assertPresignedGetPinsServeDirectives("không phải url", PDF)).toThrow(UNPARSEABLE);
    expect(() => assertPresignedGetPinsServeDirectives(getUrl([]), PDF)).toThrow(
      /thiếu tham số response-content-type/,
    );
    expect(() =>
      assertPresignedGetPinsServeDirectives(getUrl([[TYPE, PDF.responseContentType]]), PDF),
    ).toThrow(/thiếu tham số response-content-disposition/);
  });
});

describe("StoragePresignInvariantError", () => {
  it("mang tên lỗi + thao tác, KHÔNG mang URL / khoá / chữ ký", () => {
    const url = putUrl("content-length%3Bhost");
    let caught: unknown;
    try {
      assertPresignedPutSignsContentType(url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StoragePresignInvariantError);
    const error = caught as StoragePresignInvariantError;
    expect(error.name).toBe("StoragePresignInvariantError");
    expect(error.operation).toBe("PUT");
    expect(error.message).not.toContain("storage.invalid");
    expect(error.message).not.toContain("khoa");
    expect(error.message).not.toContain("X-Amz-Signature");
  });

  it("thao tác GET ghi đúng nhãn", () => {
    expect(() => assertPresignedGetPinsServeDirectives(`${BASE}?${SIG}`, PNG)).toThrow(
      expect.objectContaining({ operation: "GET" }),
    );
  });

  it("lệch giá trị ở URL GET ⇒ thông điệp nêu TÊN tham số, không chép giá trị nào (tên tệp không vào log)", () => {
    const url = getUrl([
      [TYPE, "text/html"],
      [DISPOSITION, 'attachment; filename="gia-tri-tren-url.bin"'],
    ]);
    let caught: unknown;
    try {
      assertPresignedGetPinsServeDirectives(url, PDF);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StoragePresignInvariantError);
    const { message } = caught as StoragePresignInvariantError;
    expect(message).toContain("response-content-type");
    expect(message).not.toContain("text/html");
    expect(message).not.toContain("application/pdf");
    expect(message).not.toContain("bao cao");
    expect(message).not.toContain("gia-tri-tren-url");
  });
});

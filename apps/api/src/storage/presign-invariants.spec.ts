/**
 * S16-SOCIAL-FILEDISPOSITION-1 L1 — tự kiểm URL đã ký (hàm thuần).
 *
 * Ca P5 của plan §4. URL ở đây là chuỗi dựng tay (host `.invalid`, chữ ký giả ngắn) — không ký thật, không mạng.
 */
import { describe, expect, it } from "vitest";
import {
  StoragePresignInvariantError,
  assertPresignedGetPinsContentType,
  assertPresignedPutSignsContentType,
} from "./presign-invariants";

const BASE = "http://storage.invalid:9000/bucket/co/khoa";
const SIG = ["X-Amz-Signature", "00"].join("=");

function putUrl(signedHeaders: string | null): string {
  const signed = signedHeaders === null ? "" : `&X-Amz-SignedHeaders=${signedHeaders}`;
  return `${BASE}?X-Amz-Expires=300${signed}&${SIG}`;
}

describe("assertPresignedPutSignsContentType — P5", () => {
  it.each([
    ["thiếu content-type", putUrl("content-length%3Bhost")],
    ["không có tham số SignedHeaders", putUrl(null)],
    ["tên gần giống (x-content-type)", putUrl("content-length%3Bhost%3Bx-content-type")],
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
});

describe("assertPresignedGetPinsContentType — P5", () => {
  it.each([
    ["thiếu response-content-type", `${BASE}?X-Amz-Expires=300&${SIG}`],
    ["response-content-type rỗng", `${BASE}?response-content-type=&${SIG}`],
    [
      "chỉ có response-content-disposition",
      `${BASE}?response-content-disposition=attachment&${SIG}`,
    ],
    ["chuỗi không phải URL", "không phải url"],
  ])("%s ⇒ ném StoragePresignInvariantError", (_label, url) => {
    expect(() => assertPresignedGetPinsContentType(url)).toThrow(StoragePresignInvariantError);
  });

  it("đủ ⇒ không ném", () => {
    expect(() =>
      assertPresignedGetPinsContentType(`${BASE}?response-content-type=image%2Fpng&${SIG}`),
    ).not.toThrow();
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
    expect(() => assertPresignedGetPinsContentType(`${BASE}?${SIG}`)).toThrow(
      expect.objectContaining({ operation: "GET" }),
    );
  });
});

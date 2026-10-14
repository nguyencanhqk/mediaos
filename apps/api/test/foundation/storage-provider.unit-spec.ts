import { describe, expect, it } from "vitest";
import { expectedNoSniff, isR2Endpoint } from "../helpers/storage-provider";

/**
 * S19-OPS-STORAGEPUBLIC-1 (plan v2 D2 · ca P-1) — nhận diện endpoint R2 bằng quy tắc DƯƠNG trên hostname,
 * để ca S6 của `s16-filedisposition-storage.int-spec.ts` ghim đúng hành vi đã đo của từng nhà cung cấp.
 * Mã tài khoản giả dựng bằng ghép chuỗi (không literal hex dài — gitleaks).
 */
const ACCOUNT = "0123456789abcdef".repeat(2);
const R2 = `https://${ACCOUNT}.r2.cloudflarestorage.com`;

describe("storage-provider — isR2Endpoint / expectedNoSniff", () => {
  it.each([
    ["host giả mạo có đuôi lạ", "https://r2.cloudflarestorage.com.evil.test"],
    ["đúng tiền tố nhưng thêm nhãn sau", `https://${ACCOUNT}.r2.cloudflarestorage.com.x`],
    ["mã tài khoản không phải 32 hex", "https://abc.r2.cloudflarestorage.com"],
    ["mã tài khoản 31 hex", `https://${ACCOUNT.slice(1)}.r2.cloudflarestorage.com`],
    // userinfo: host THẬT của URL là phần sau `@`.
    ["host R2 nằm ở phần userinfo", `https://${ACCOUNT}.r2.cloudflarestorage.com@evil.test`],
    ["http thay https", `http://${ACCOUNT}.r2.cloudflarestorage.com`],
    ["storage tự host cục bộ", "http://localhost:9000"],
    ["không phải URL", "không phải url"],
    ["vắng", undefined],
  ])("TỪ CHỐI nhận là R2 — %s ⇒ kỳ vọng header `nosniff`", (_label, endpoint) => {
    expect(isR2Endpoint(endpoint)).toBe(false);
    expect(expectedNoSniff(endpoint)).toBe("nosniff");
  });

  it.each([
    ["endpoint chuẩn", R2],
    ["có dấu / cuối", `${R2}/`],
    ["vùng pháp lý eu", `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`],
    ["vùng pháp lý fedramp", `https://${ACCOUNT}.fedramp.r2.cloudflarestorage.com`],
    // `new URL()` đưa hostname về chữ thường (hostname không phân biệt hoa-thường) ⇒ cùng một host R2.
    ["host viết chữ HOA", `https://${ACCOUNT.toUpperCase()}.R2.CLOUDFLARESTORAGE.COM`],
  ])("CHO PHÉP nhận là R2 — %s ⇒ kỳ vọng KHÔNG có header", (_label, endpoint) => {
    expect(isR2Endpoint(endpoint)).toBe(true);
    expect(expectedNoSniff(endpoint)).toBeNull();
  });
});

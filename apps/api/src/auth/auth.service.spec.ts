import { describe, it, expect } from "vitest";
import { redactEmailFromDetail } from "./auth.service";

/**
 * G6-2f residual M3 — forgotPassword ghi `err.stack` để quan sát (silent-failure F3) nhưng stack
 * KHÔNG kiểm soát được và có thể nhúng email người gọi. `redactEmailFromDetail` phải redact email
 * (PII) khỏi chuỗi chẩn đoán TRƯỚC khi log, mà vẫn giữ phần còn lại của stack.
 */
describe("redactEmailFromDetail (G6-2f M3 — scrub email khỏi log)", () => {
  const email = "Victim@Example.com";

  it("redact email khi nó xuất hiện trong chuỗi detail", () => {
    const detail = `Error: db down for ${email}\n    at AuthService.forgotPassword`;
    const out = redactEmailFromDetail(detail, email);
    expect(out).not.toContain(email);
    expect(out).toContain("[redacted-email]");
  });

  it("redact cả biến lowercase (lỗi downstream hạ chữ thường email)", () => {
    const detail = `constraint violation: ${email.toLowerCase()} already exists`;
    const out = redactEmailFromDetail(detail, email);
    expect(out).not.toContain(email.toLowerCase());
    expect(out).toContain("[redacted-email]");
  });

  it("trả nguyên detail khi email undefined/rỗng (KHÔNG split chuỗi rỗng)", () => {
    const detail = "Error: KMS unavailable";
    expect(redactEmailFromDetail(detail, undefined)).toBe(detail);
    expect(redactEmailFromDetail(detail, "")).toBe(detail);
  });

  it("giữ nguyên detail khi không có email bên trong", () => {
    const detail = "Error: KMS provider timeout";
    expect(redactEmailFromDetail(detail, email)).toBe(detail);
  });
});

import { describe, expect, it } from "vitest";
import { REDACTED_MARKER, redactAuditPayload } from "./audit-redact.helper";

/**
 * AC-8 mask-by-server (BẤT BIẾN #3): before/after của object_type nhạy cảm KHÔNG lộ field con trong DTO.
 */
describe("redactAuditPayload", () => {
  it("REDACT salary_profile before/after (không lộ tiền/PII)", () => {
    const { before, after } = redactAuditPayload(
      "salary_profile",
      { baseSalary: 99000000, bankAccount: "123" },
      { baseSalary: 120000000 },
    );
    expect(before).toEqual(REDACTED_MARKER);
    expect(after).toEqual(REDACTED_MARKER);
    expect(JSON.stringify({ before, after })).not.toContain("99000000");
    expect(JSON.stringify({ before, after })).not.toContain("bankAccount");
  });

  it.each([
    "payslip",
    "api_key",
    "platform_account",
    "break_glass_access",
    "encryption_key",
    "webhook_endpoint",
  ])("REDACT object_type nhạy cảm %s", (objectType) => {
    const { before, after } = redactAuditPayload(objectType, { secret: "x" }, { token: "y" });
    expect(before).toEqual(REDACTED_MARKER);
    expect(after).toEqual(REDACTED_MARKER);
    expect(JSON.stringify({ before, after })).not.toContain("secret");
  });

  it("GIỮ NGUYÊN object_type không nhạy cảm (task)", () => {
    const { before, after } = redactAuditPayload("task", null, { title: "Viết kịch bản" });
    expect(before).toBeNull();
    expect(after).toEqual({ title: "Viết kịch bản" });
  });

  it("null before/after vẫn null sau redact (không tạo marker giả)", () => {
    const { before, after } = redactAuditPayload("salary_profile", null, null);
    expect(before).toBeNull();
    expect(after).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { FOUNDATION_ERROR_CODES } from "./error-codes";
import { FOUNDATION_FILE_ERROR_CODES } from "../files";

/**
 * S2-FND-CONTRACT-1 — catalog FOUNDATION-ERR-* là nguồn sự thật DTO (CLAUDE.md §4).
 * Bảo vệ: mọi mã có prefix ổn định, KHÔNG giẫm namespace file-domain, và các mã lõi tồn tại
 * để service import LẠI (chống drift bản cục bộ ở apps/api).
 */
describe("FOUNDATION_ERROR_CODES catalog", () => {
  it("mọi mã đều có prefix FOUNDATION-ERR- ổn định", () => {
    const values = Object.values(FOUNDATION_ERROR_CODES);
    expect(values.length).toBeGreaterThanOrEqual(11);
    for (const code of values) {
      expect(code).toMatch(/^FOUNDATION-ERR-[A-Z-]+$/);
    }
  });

  it("chứa các mã lõi cho 6 nhóm service trong scope", () => {
    expect(FOUNDATION_ERROR_CODES.COMPANY_NOT_FOUND).toBe("FOUNDATION-ERR-COMPANY-NOT-FOUND");
    expect(FOUNDATION_ERROR_CODES.COMPANY_SUSPENDED).toBe("FOUNDATION-ERR-COMPANY-SUSPENDED");
    expect(FOUNDATION_ERROR_CODES.SETTING_NOT_FOUND).toBe("FOUNDATION-ERR-SETTING-NOT-FOUND");
    expect(FOUNDATION_ERROR_CODES.AUDIT_NOT_FOUND).toBe("FOUNDATION-ERR-AUDIT-NOT-FOUND");
    expect(FOUNDATION_ERROR_CODES.MODULE_NOT_FOUND).toBe("FOUNDATION-ERR-MODULE-NOT-FOUND");
    expect(FOUNDATION_ERROR_CODES.MODULE_CORE_LOCKED).toBe("FOUNDATION-ERR-MODULE-CORE-LOCKED");
    expect(FOUNDATION_ERROR_CODES.HOLIDAY_NOT_FOUND).toBe("FOUNDATION-ERR-HOLIDAY-NOT-FOUND");
    expect(FOUNDATION_ERROR_CODES.HOLIDAY_DUPLICATE).toBe("FOUNDATION-ERR-HOLIDAY-DUPLICATE");
    expect(FOUNDATION_ERROR_CODES.RETENTION_POLICY_NOT_FOUND).toBe(
      "FOUNDATION-ERR-RETENTION-POLICY-NOT-FOUND",
    );
  });

  it("KHÔNG giẫm namespace mã domain file (catalog tách biệt)", () => {
    const generic = new Set<string>(Object.values(FOUNDATION_ERROR_CODES));
    const file = new Set<string>(Object.values(FOUNDATION_FILE_ERROR_CODES));
    for (const code of file) {
      expect(generic.has(code)).toBe(false);
    }
    // Mã file luôn có infix -FILE- để không đụng catalog nghiệp vụ chung.
    for (const code of file) {
      expect(code.startsWith("FOUNDATION-FILE-ERR-")).toBe(true);
    }
  });
});

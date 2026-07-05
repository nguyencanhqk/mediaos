import { ForbiddenException } from "@nestjs/common";
import { FOUNDATION_ERROR_CODES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { assertCompanyActive, isCompanyActive } from "./company-status";

/**
 * S2-FND-CONTRACT-1 — ranh giới 403 service-level: company Suspended là BUSINESS RULE (không phải
 * PermissionGuard) ⇒ mang mã FOUNDATION-ERR-COMPANY-SUSPENDED, message gốc GIỮ NGUYÊN.
 */
describe("assertCompanyActive — 403 boundary + code payload", () => {
  it("active → không ném", () => {
    expect(() => assertCompanyActive("active")).not.toThrow();
    expect(isCompanyActive("active")).toBe(true);
  });

  it.each(["suspended", "inactive", null, undefined, ""])(
    "non-active (%s) → Forbidden với code FOUNDATION-ERR-COMPANY-SUSPENDED + message gốc",
    (status) => {
      let caught: unknown;
      try {
        assertCompanyActive(status as string | null | undefined);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      const res = (caught as ForbiddenException).getResponse() as {
        code?: string;
        message?: string;
      };
      expect(res.code).toBe(FOUNDATION_ERROR_CODES.COMPANY_SUSPENDED);
      // message-preservation: KHÔNG bị thay bằng default class-name message.
      expect(res.message).toBe("Công ty đang bị tạm ngưng — không thể thực hiện thao tác này.");
    },
  );
});

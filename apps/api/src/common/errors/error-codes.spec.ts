import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  FOUNDATION_FILE_ERROR_CODES as CONTRACT_FILE_CODES,
  FOUNDATION_ERROR_CODES as CONTRACT_CODES,
} from "@mediaos/contracts";
import {
  ERROR_CODES,
  FOUNDATION_ERROR_CODES,
  FOUNDATION_FILE_ERROR_CODES,
  httpStatusToCode,
} from "./error-codes";

/**
 * S2-FND-CONTRACT-1 — reconcile drift: apps/api KHÔNG khai báo bản cục bộ, chỉ re-export TỪ contracts
 * (nguồn sự thật DTO). Bảo vệ: (a) identity re-export, (b) chuỗi DUP_LINK/DUP_PRIMARY bất biến (client
 * cũ bắt theo code), (c) filter map status→code không đổi.
 */
describe("error-codes re-export reconcile (S2-FND-CONTRACT-1)", () => {
  it("FOUNDATION_FILE_ERROR_CODES là ĐÚNG object từ @mediaos/contracts (không phải bản cục bộ)", () => {
    expect(FOUNDATION_FILE_ERROR_CODES).toBe(CONTRACT_FILE_CODES);
  });

  it("FOUNDATION_ERROR_CODES re-export ĐÚNG catalog contracts", () => {
    expect(FOUNDATION_ERROR_CODES).toBe(CONTRACT_CODES);
  });

  it("giá trị chuỗi DUP_LINK/DUP_PRIMARY bất biến sau reconcile", () => {
    expect(FOUNDATION_FILE_ERROR_CODES.DUP_LINK).toBe("FOUNDATION-FILE-ERR-DUP-LINK");
    expect(FOUNDATION_FILE_ERROR_CODES.DUP_PRIMARY).toBe("FOUNDATION-FILE-ERR-DUP-PRIMARY");
  });

  it("httpStatusToCode map ổn định (guard-level 403 vẫn AUTH-ERR-FORBIDDEN)", () => {
    expect(httpStatusToCode(HttpStatus.FORBIDDEN)).toBe(ERROR_CODES.AUTH_FORBIDDEN);
    expect(httpStatusToCode(HttpStatus.NOT_FOUND)).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
    expect(httpStatusToCode(HttpStatus.CONFLICT)).toBe(ERROR_CODES.RESOURCE_CONFLICT);
    // 422 validation_schema → giữ VALIDATION-ERR-* (web-core prefix-match phụ thuộc).
    expect(httpStatusToCode(HttpStatus.UNPROCESSABLE_ENTITY)).toBe(ERROR_CODES.VALIDATION);
  });
});

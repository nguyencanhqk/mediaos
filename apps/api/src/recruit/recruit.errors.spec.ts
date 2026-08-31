import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { ErrorDetail } from "@mediaos/contracts";
import { mapRecruitPgError } from "./recruit.errors";

/**
 * S12-RECRUIT-BE-1 — `mapRecruitPgError` với lỗi PG bọc `.cause` 1–3 tầng (drizzle bọc lỗi —
 * memory `drizzle-wraps-pg-error-code-in-cause`). Assert theo MÃ + `kind` trong details MẢNG.
 */

function pgError(code: string, constraint: string, depth: number): Error {
  let err: Error = Object.assign(new Error("pg"), { code, constraint });
  for (let i = 0; i < depth; i++) {
    err = new Error(`wrap-${i}`, { cause: err });
  }
  return err;
}

function unwrap(mapped: Error | null): { code: string; kind: string | undefined } {
  expect(mapped).not.toBeNull();
  expect(mapped).toBeInstanceOf(HttpException);
  const res = (mapped as HttpException).getResponse() as { code: string; details?: ErrorDetail[] };
  expect(Array.isArray(res.details), "details phải là MẢNG ErrorDetail").toBe(true);
  const kind = res.details?.find((d) => d.field === "kind")?.message;
  return { code: res.code, kind };
}

describe("mapRecruitPgError", () => {
  it("23505 uq_offers_candidate_open → 409 006 (cause 0–3 tầng)", () => {
    for (const depth of [0, 1, 3]) {
      const { code } = unwrap(
        mapRecruitPgError(pgError("23505", "uq_offers_candidate_open", depth)),
      );
      expect(code, `depth=${depth}`).toBe("RECRUIT-ERR-006");
    }
  });

  it("23505 uq_candidates_company_employee → 008 kind already-converted", () => {
    const { code, kind } = unwrap(
      mapRecruitPgError(pgError("23505", "uq_candidates_company_employee", 1)),
    );
    expect(code).toBe("RECRUIT-ERR-008");
    expect(kind).toBe("already-converted");
  });

  it("23505 uq_interview_feedbacks → 409 012", () => {
    const { code } = unwrap(mapRecruitPgError(pgError("23505", "uq_interview_feedbacks", 2)));
    expect(code).toBe("RECRUIT-ERR-012");
  });

  it("23505 employee_profiles_company_code_active_uq → 008 kind employee-code-conflict (plan-review #1: KHÔNG 500)", () => {
    const { code, kind } = unwrap(
      mapRecruitPgError(pgError("23505", "employee_profiles_company_code_active_uq", 1)),
    );
    expect(code).toBe("RECRUIT-ERR-008");
    expect(kind).toBe("employee-code-conflict");
  });

  it("23514 chk_interviews_range → 422 013 kind invalid-time-range (lưới thứ hai)", () => {
    const { code, kind } = unwrap(mapRecruitPgError(pgError("23514", "chk_interviews_range", 1)));
    expect(code).toBe("RECRUIT-ERR-013");
    expect(kind).toBe("invalid-time-range");
  });

  it("ngoài phổ RECRUIT → null (caller `?? err` giữ nguyên lỗi gốc)", () => {
    expect(mapRecruitPgError(pgError("23505", "uq_something_else", 1))).toBeNull();
    expect(mapRecruitPgError(pgError("23514", "chk_offers_salary", 1))).toBeNull();
    expect(mapRecruitPgError(pgError("23503", "any_fk", 0))).toBeNull();
    expect(mapRecruitPgError(new Error("plain"))).toBeNull();
    expect(mapRecruitPgError(undefined)).toBeNull();
  });

  it("23505 uq_interview_participants CỐ Ý không map (de-dup ở biên) → null", () => {
    expect(mapRecruitPgError(pgError("23505", "uq_interview_participants", 1))).toBeNull();
  });
});

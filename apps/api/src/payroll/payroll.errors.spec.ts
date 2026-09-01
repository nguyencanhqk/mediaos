import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { mapPayrollPgError, PAYROLL_ERR_CODE } from "./payroll.errors";

/**
 * S13-PAYROLL-BE-1 — `mapPayrollPgError`: bóc lỗi PG → mã PAYROLL (SPEC-11 §12, plan §8).
 *
 * ⚠️ Ca quan trọng nhất ở đây là **`23514` KHÔNG có tên constraint**. Mig `0564` dựng trigger
 * `enforce_bonus_penalty_freeze` bằng `RAISE EXCEPTION … USING ERRCODE = 'check_violation'` mà
 * **không kèm `USING CONSTRAINT`** ⇒ `err.constraint` rỗng. Không có nhánh này thì lỗi đó rơi thành
 * **500 ở vùng đỏ**.
 *
 * Phân công bằng chứng, hai lớp:
 *  · `payroll-be1-errors.int-spec.ts` chứng minh **tiền đề** — DB THẬT sinh ra `23514` với
 *    `constraint` rỗng (nếu mai này trigger bắt đầu mang tên, ca đó ĐỎ và nhánh dưới thành code chết);
 *  · spec này chứng minh **cách xử lý** — mapper biến đúng hình dạng đó thành 409, không phải 500.
 *
 * drizzle bọc lỗi pg trong `.cause` (`drizzle-wraps-pg-error-code-in-cause`) ⇒ ca bọc `cause` cũng
 * phải xanh, không chỉ ca lỗi trần.
 */

const pgError = (fields: Record<string, unknown>): Error => Object.assign(new Error("pg"), fields);

/** Hình dạng THẬT drizzle giao cho service: lỗi pg nằm trong `.cause`. */
const wrapped = (fields: Record<string, unknown>): Error =>
  Object.assign(new Error("DrizzleQueryError"), { cause: pgError(fields) });

const codeOf = (e: Error | null): string | undefined =>
  (e as ConflictException | null)?.getResponse?.() &&
  ((e as ConflictException).getResponse() as { code?: string }).code;

const kindOf = (e: Error | null): string | undefined => {
  const res = (e as ConflictException | null)?.getResponse?.() as
    | { details?: Array<Record<string, string>> }
    | undefined;
  return res?.details?.find((d) => d["field"] === "kind")?.["message"];
};

describe("S13-PAYROLL-BE-1 · mapPayrollPgError", () => {
  it("23514 KHÔNG có tên constraint (trigger freeze) ⇒ 409, KHÔNG null/500", () => {
    for (const err of [
      pgError({ code: "23514" }),
      pgError({ code: "23514", constraint: "" }),
      wrapped({ code: "23514" }),
    ]) {
      const mapped = mapPayrollPgError(err);
      expect(mapped, "trả null ⇒ caller ném lỗi gốc ⇒ 500 ở vùng đỏ").not.toBeNull();
      expect(mapped).toBeInstanceOf(ConflictException);
      expect(codeOf(mapped)).toBe(PAYROLL_ERR_CODE.BONUS_ALREADY_CONSUMED);
      expect(kindOf(mapped)).toBe("bonus-frozen-race");
    }
  });

  it("23505 theo TÊN constraint — 008 (kỳ trùng tháng) · 014 (hồ sơ lương trùng ngày)", () => {
    expect(
      codeOf(
        mapPayrollPgError(
          wrapped({ code: "23505", constraint: "payroll_periods_company_month_uq" }),
        ),
      ),
    ).toBe(PAYROLL_ERR_CODE.PERIOD_MONTH_EXISTS);
    expect(
      codeOf(
        mapPayrollPgError(
          wrapped({ code: "23505", constraint: "salary_profiles_company_user_effective_uq" }),
        ),
      ),
    ).toBe(PAYROLL_ERR_CODE.SALARY_EFFECTIVE_EXISTS);
  });

  it("`payroll_period_lines_adjustment_check` ⇒ null (SPEC-11 §12 xếp về 400, không chiếm mã)", () => {
    expect(
      mapPayrollPgError(
        wrapped({ code: "23514", constraint: "payroll_period_lines_adjustment_check" }),
      ),
    ).toBeNull();
  });

  it("ngoài phổ ⇒ null (caller ném lỗi gốc) — mapper KHÔNG được nuốt lỗi lạ", () => {
    // Nuốt lỗi lạ thành 409 là silent-failure: một bug FK/NOT NULL sẽ đội lốt xung đột nghiệp vụ.
    expect(mapPayrollPgError(wrapped({ code: "23503", constraint: "some_fk" }))).toBeNull();
    expect(mapPayrollPgError(new Error("không phải lỗi pg"))).toBeNull();
    expect(mapPayrollPgError(undefined)).toBeNull();
  });

  it("23505 với constraint LẠ ⇒ null (không đoán mã theo cảm tính)", () => {
    expect(mapPayrollPgError(wrapped({ code: "23505", constraint: "users_email_uq" }))).toBeNull();
  });
});
describe("S13-PAYROLL-BE-2 · mapPayrollPgError — 6 nhánh mới (§8b)", () => {
  it("`payslips_period_user_uq` ⇒ 409 PAYROLL-ERR-006 `payslip-duplicate`", () => {
    const e = mapPayrollPgError(wrapped({ code: "23505", constraint: "payslips_period_user_uq" }));
    expect(codeOf(e)).toBe("PAYROLL-ERR-006");
    expect(kindOf(e)).toBe("payslip-duplicate");
  });

  it("`payslip_acknowledgements_payslip_user_uq` ⇒ 409 PAYROLL-ERR-015 `already-acknowledged`", () => {
    const e = mapPayrollPgError(
      wrapped({
        code: "23505",
        constraint: "payslip_acknowledgements_payslip_user_uq",
      }),
    );
    expect(codeOf(e)).toBe("PAYROLL-ERR-015");
    expect(kindOf(e)).toBe("already-acknowledged");
  });

  it("`payroll_periods_four_eyes_check` ⇒ 409 PAYROLL-ERR-005 `four-eyes` (chốt cuối cho RACE)", () => {
    // Service đã tiền-kiểm `submitted_by <> actor` dưới row-lock; nhánh này chỉ chạy khi hai lượt
    // duyệt chen nhau. Không map ⇒ 23514 rơi thành **500 ở vùng đỏ**.
    const e = mapPayrollPgError(
      wrapped({ code: "23514", constraint: "payroll_periods_four_eyes_check" }),
    );
    expect(codeOf(e)).toBe("PAYROLL-ERR-005");
    expect(kindOf(e)).toBe("four-eyes");
  });

  it.each([
    "payroll_periods_approved_pair_check",
    "payroll_periods_published_pair_check",
    "payroll_periods_generated_pair_check",
    "payroll_periods_calculated_needs_attendance_check",
  ])("CHECK cặp vết duyệt `%s` ⇒ 409 mã 001 `trail-pair-violation`, KHÔNG 500", (constraint) => {
    // Mọi hành động FSM đi qua `applyTransitionTx` (bảng TRAIL_RESET) nên bốn CHECK này chỉ nổ khi có
    // BUG — nhưng bug ở vùng đỏ phải hiện thành lỗi ĐỌC ĐƯỢC, không phải 500 vô danh.
    const e = mapPayrollPgError(wrapped({ code: "23514", constraint }));
    expect(codeOf(e)).toBe("PAYROLL-ERR-001");
    expect(kindOf(e)).toBe("trail-pair-violation");
  });

  it("ĐỐI CHỨNG: CHECK 23514 có tên NGOÀI phổ ⇒ vẫn null (không đoán mã theo cảm tính)", () => {
    // Nếu nhánh trên khớp quá rộng (ví dụ chỉ so `.includes('pair_check')`) thì ca này ĐỎ.
    expect(
      mapPayrollPgError(wrapped({ code: "23514", constraint: "some_other_pair_check" })),
    ).toBeNull();
  });
});

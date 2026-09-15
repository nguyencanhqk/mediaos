import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { FormulaError } from "./formula/formula.errors";
import { formulaErrorToHttp, mapPayrollPgError, PAYROLL_ERR_CODE } from "./payroll.errors";

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
  it("23514 KHÔNG có tên constraint — trigger thưởng/phạt (tiền tố message) ⇒ 409 013, KHÔNG null/500", () => {
    const msg =
      "bonus_penalty_freeze_guard: Bonus (id=x, ky 2026-09) da roi Pending hoac da consume";
    for (const err of [
      pgError({ code: "23514", message: msg }),
      pgError({ code: "23514", constraint: "", message: msg }),
      wrapped({ code: "23514", message: msg }),
    ]) {
      const mapped = mapPayrollPgError(err);
      expect(mapped, "trả null ⇒ caller ném lỗi gốc ⇒ 500 ở vùng đỏ").not.toBeNull();
      expect(mapped).toBeInstanceOf(ConflictException);
      expect(codeOf(mapped)).toBe(PAYROLL_ERR_CODE.BONUS_ALREADY_CONSUMED);
      expect(kindOf(mapped)).toBe("bonus-frozen-race");
    }
  });

  it("S15-PAYROLL-DB-1B — message dạng TAG `bonus_penalty_freeze_guard:<tag>:` (5 tag ĐÓNG của mig 0574) ⇒ 409 013 theo luật tiền tố", () => {
    for (const tag of ["frozen", "rebind", "status-terminal", "period-frozen", "not-found"]) {
      const mapped = mapPayrollPgError(
        wrapped({ code: "23514", message: `bonus_penalty_freeze_guard:${tag}: khoan x ky y` }),
      );
      expect(codeOf(mapped), tag).toBe(PAYROLL_ERR_CODE.BONUS_ALREADY_CONSUMED);
      expect(kindOf(mapped), tag).toBe("bonus-frozen-race");
    }
  });

  it("S15-PAYROLL-BE-2 M2 — 23514 không tên của trigger ĐÓNG BĂNG thành phần hệ thống ⇒ 024, KHÔNG dán nhầm 013", () => {
    const mapped = mapPayrollPgError(
      wrapped({
        code: "23514",
        message:
          "salary_components: hang he thong (code=TONG_KHAU_TRU) DONG BANG — chi sua duoc name/sort_order.",
      }),
    );
    expect(codeOf(mapped)).toBe(PAYROLL_ERR_CODE.COMPONENT_CONFLICT);
    expect(kindOf(mapped)).toBe("system-component-immutable");
  });

  it("ĐỐI CHỨNG M2: 23514 không tên với message LẠ (hoặc không message) ⇒ null — trigger tương lai không bị gắn 013", () => {
    expect(
      mapPayrollPgError(wrapped({ code: "23514", message: "payroll_payment_lines_freeze: x" })),
    ).toBeNull();
    expect(mapPayrollPgError(pgError({ code: "23514" }))).toBeNull();
  });

  it("M2 chỉ đọc message của NODE mang `code` — message lớp drizzle bên ngoài không đánh lừa được", () => {
    const outer = Object.assign(new Error("bonus_penalty_freeze_guard: giả ở lớp ngoài"), {
      cause: pgError({ code: "23514", message: "salary_components: that" }),
    });
    expect(kindOf(mapPayrollPgError(outer))).toBe("system-component-immutable");
  });

  it("S15-PAYROLL-BE-2 — ràng buộc track B map theo TÊN (không rơi 500)", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        { code: "23505", constraint: "salary_components_company_code_uq" },
        PAYROLL_ERR_CODE.COMPONENT_CONFLICT,
        "component-code-exists",
      ],
      [
        { code: "23505", constraint: "payroll_templates_company_code_uq" },
        PAYROLL_ERR_CODE.TEMPLATE_CONFLICT,
        "template-code-exists",
      ],
      [
        { code: "23505", constraint: "payroll_statutory_rates_company_effective_uq" },
        PAYROLL_ERR_CODE.STATUTORY_RATE_CONFLICT,
        "rate-effective-date-exists",
      ],
      [
        { code: "23514", constraint: "salary_components_code_shape_check" },
        PAYROLL_ERR_CODE.COMPONENT_CONFLICT,
        "component-code-reserved",
      ],
      [
        { code: "23514", constraint: "salary_components_system_not_deletable" },
        PAYROLL_ERR_CODE.COMPONENT_CONFLICT,
        "system-component-immutable",
      ],
      [
        { code: "23514", constraint: "salary_components_value_pair_check" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "component-value-pair",
      ],
      [
        { code: "23514", constraint: "salary_components_formula_len_check" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "formula-too-long",
      ],
      [
        { code: "23514", constraint: "payroll_template_components_formula_len_check" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "formula-too-long",
      ],
      [
        { code: "23514", constraint: "salary_components_engine_kind_check" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "component-value-pair",
      ],
      [
        { code: "23514", constraint: "payroll_templates_scope_pair_check" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "template-scope-pair",
      ],
      [
        { code: "23503", constraint: "payroll_templates_org_unit_id_company_fk" },
        PAYROLL_ERR_CODE.NOT_FOUND,
        "not-found",
      ],
      [
        { code: "23503", constraint: "payroll_template_components_component_id_company_fk" },
        PAYROLL_ERR_CODE.FORMULA_INVALID,
        "template-component-unknown",
      ],
    ];
    for (const [fields, code, kind] of cases) {
      const mapped = mapPayrollPgError(wrapped(fields));
      expect(codeOf(mapped), JSON.stringify(fields)).toBe(code);
      expect(kindOf(mapped), JSON.stringify(fields)).toBe(kind);
    }
  });

  it("formulaErrorToHttp: mã suy từ kind của engine; giữ kind + vị trí; chu trình nối mũi tên; extra đi kèm", () => {
    const detail = (e: Error, field: string) =>
      (
        (e as ConflictException).getResponse() as { details?: Array<Record<string, string>> }
      ).details?.find((d) => d["field"] === field)?.["message"];

    const cycle = formulaErrorToHttp(
      new FormulaError("formula-cycle", "vòng", { cycle: ["A", "B", "A"] }),
    );
    expect(codeOf(cycle)).toBe("PAYROLL-ERR-019");
    expect(kindOf(cycle)).toBe("formula-cycle");
    expect(detail(cycle, "cycle")).toBe("A → B → A");

    const tooLong = formulaErrorToHttp(new FormulaError("formula-too-long", "dài", { pos: 500 }), {
      template: "MAU_X",
    });
    expect(codeOf(tooLong)).toBe("PAYROLL-ERR-018");
    expect(detail(tooLong, "pos")).toBe("500");
    expect(detail(tooLong, "template")).toBe("MAU_X");

    expect(codeOf(formulaErrorToHttp(new FormulaError("division-by-zero", "chia 0")))).toBe(
      "PAYROLL-ERR-020",
    );
    expect(
      codeOf(
        formulaErrorToHttp(
          new FormulaError("statutory-rate-incomplete", "bậc", { reason: "count" }),
        ),
      ),
    ).toBe("PAYROLL-ERR-022");
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

  it("S15-PAYROLL-BE-3 — `bonus_penalties_four_eyes_check` (mig 0575) ⇒ 409 PAYROLL-ERR-012 `self-approval`, KHÔNG 500", () => {
    // 027 tiền-kiểm `created_by <> actor`; CHECK là lưới cuối cho RACE / đường ghi nội bộ — cùng mã + kind với service.
    const e = mapPayrollPgError(
      wrapped({ code: "23514", constraint: "bonus_penalties_four_eyes_check" }),
    );
    expect(codeOf(e)).toBe(PAYROLL_ERR_CODE.BONUS_SELF_APPROVAL);
    expect(kindOf(e)).toBe("self-approval");
  });

  it("S15-PAYROLL-BE-3 — formulaErrorToHttp: 021 `grossup-not-converged` mang `iterations` + `reason` + `userId`, KHÔNG sai số tiền", () => {
    const e = formulaErrorToHttp(
      new FormulaError("grossup-not-converged", "không hội tụ", {
        iterations: 30,
        reason: "not-converged",
      }),
      { userId: "u-1" },
    );
    const body = e.getResponse() as {
      code: string;
      details: Array<{ field: string; message: string }>;
    };
    expect(body.code).toBe("PAYROLL-ERR-021");
    expect(body.details).toEqual([
      { field: "kind", message: "grossup-not-converged", rule: "payroll" },
      { field: "userId", message: "u-1", rule: "payroll" },
      { field: "reason", message: "not-converged", rule: "payroll" },
      { field: "iterations", message: "30", rule: "payroll" },
    ]);
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

/**
 * S15-PAYROLL-BE-4 — bảng chân trị map lỗi DB track C (plan §4.9 · §6.1.1). Ba lớp: (1) TAG của ba trigger mig 0572
 * — tag ĐÃ map ⇒ đúng mã/kind, tag KHÔNG map ⇒ `null` (500 có chủ đích, service phải chặn trước); (2) UNIQUE/CHECK/FK
 * theo TÊN; (3) message/details KHÔNG BAO GIỜ chở tham số câu SQL (số tài khoản có thể nằm trong `params`).
 */
describe("S15-PAYROLL-BE-4 · mapPayrollPgError — track C (tạm ứng · đợt chi · ngân sách)", () => {
  /** Giá trị giả «trông như số TK» — nếu lọt vào message/details của lỗi đã map thì ca ĐỎ. */
  const FAKE_PARAM = "9999-1111";
  const tagErr = (trigger: string, tag: string) =>
    wrapped({
      code: "23514",
      message: `${trigger}:${tag}: dot ${FAKE_PARAM} (id=x) da Completed — chi sua duoc note`,
    });
  const detailsOf = (e: Error | null) =>
    (
      (e as ConflictException | null)?.getResponse?.() as {
        details?: Array<Record<string, string>>;
      }
    )?.details ?? [];

  it.each([
    [
      "payroll_payment_batch_freeze",
      "insert-completed",
      "PAYROLL-ERR-027",
      "batch-already-completed",
    ],
    [
      "payroll_payment_batch_freeze",
      "period-immutable",
      "PAYROLL-ERR-027",
      "batch-already-completed",
    ],
    ["payroll_payment_batch_freeze", "frozen", "PAYROLL-ERR-027", "batch-already-completed"],
    ["payroll_payment_line_guard", "frozen", "PAYROLL-ERR-027", "batch-already-completed"],
    [
      "payroll_payment_line_guard",
      "insert-into-completed",
      "PAYROLL-ERR-027",
      "batch-already-completed",
    ],
    [
      "payroll_payment_line_guard",
      "move-to-completed",
      "PAYROLL-ERR-027",
      "batch-already-completed",
    ],
    ["payroll_advance_freeze_guard", "frozen", "PAYROLL-ERR-025", "advance-not-pending"],
    ["payroll_advance_freeze_guard", "status-terminal", "PAYROLL-ERR-025", "advance-not-pending"],
    ["payroll_advance_freeze_guard", "insert-shape", "PAYROLL-ERR-025", "advance-not-pending"],
    ["payroll_advance_freeze_guard", "rebind", "PAYROLL-ERR-025", "advance-already-deducted"],
    ["payroll_advance_freeze_guard", "period-frozen", "PAYROLL-ERR-026", "advance-period-frozen"],
  ])(
    "TAG `%s:%s:` ⇒ 409 %s `%s`; details mang trigger+tag, KHÔNG mang tham số",
    (trigger, tag, code, kind) => {
      const e = mapPayrollPgError(tagErr(trigger, tag));
      expect(e, "tag đã map mà trả null ⇒ 500 vùng đỏ").toBeInstanceOf(ConflictException);
      expect(codeOf(e)).toBe(code);
      expect(kindOf(e)).toBe(kind);
      const d = detailsOf(e);
      expect(d.find((x) => x["field"] === "trigger")?.["message"]).toBe(trigger);
      expect(d.find((x) => x["field"] === "tag")?.["message"]).toBe(tag);
      expect(JSON.stringify((e as ConflictException).getResponse())).not.toContain(FAKE_PARAM);
    },
  );

  it.each([
    ["payroll_payment_batch_freeze", "has-active-lines"],
    ["payroll_payment_line_guard", "not-found"],
    ["payroll_payment_line_guard", "cross-user"],
    ["payroll_payment_line_guard", "cross-period"],
    ["payroll_advance_freeze_guard", "not-found"],
  ])(
    "TAG `%s:%s:` CỐ Ý KHÔNG map ⇒ null (500 có chủ đích — service phải chặn trước, plan §3.6)",
    (trigger, tag) => {
      expect(mapPayrollPgError(tagErr(trigger, tag))).toBeNull();
    },
  );

  it("tập tag ĐÃ map là ĐÓNG — tag lạ cùng tiền tố trigger ⇒ null", () => {
    expect(mapPayrollPgError(tagErr("payroll_advance_freeze_guard", "some-new-tag"))).toBeNull();
    expect(mapPayrollPgError(tagErr("payroll_payment_batch_freeze", "deleted"))).toBeNull();
  });

  it.each(["payroll_payment_lines_payslip_uq", "payroll_payment_lines_batch_user_uq"])(
    "23505 `%s` ⇒ 409 027 `payee-already-in-batch` (CẢ HAI tên unique, cùng kind — SPEC-11 §12.1)",
    (constraint) => {
      const e = mapPayrollPgError(wrapped({ code: "23505", constraint }));
      expect(codeOf(e)).toBe(PAYROLL_ERR_CODE.PAYMENT_BATCH_CONFLICT);
      expect(kindOf(e)).toBe("payee-already-in-batch");
    },
  );

  it("23505 `payroll_payment_batches_company_code_uq` ⇒ 409 027 `batch-code-exists`", () => {
    const e = mapPayrollPgError(
      wrapped({ code: "23505", constraint: "payroll_payment_batches_company_code_uq" }),
    );
    expect(codeOf(e)).toBe("PAYROLL-ERR-027");
    expect(kindOf(e)).toBe("batch-code-exists");
  });

  it("23505 `payroll_budgets_year_unit_uq` ⇒ 409 029 `budget-exists` (kể cả bẫy NULL đơn vị — unique COALESCE)", () => {
    const e = mapPayrollPgError(
      wrapped({ code: "23505", constraint: "payroll_budgets_year_unit_uq" }),
    );
    expect(codeOf(e)).toBe(PAYROLL_ERR_CODE.BUDGET_EXISTS);
    expect(kindOf(e)).toBe("budget-exists");
  });

  it("23514 `payroll_advances_four_eyes_check` ⇒ 409 025 `self-approval` (lưới cuối RACE cho vế created_by)", () => {
    const e = mapPayrollPgError(
      wrapped({ code: "23514", constraint: "payroll_advances_four_eyes_check" }),
    );
    expect(codeOf(e)).toBe(PAYROLL_ERR_CODE.ADVANCE_CONFLICT);
    expect(kindOf(e)).toBe("self-approval");
  });

  it.each([
    "payroll_payment_batches_completed_pair_check",
    "payroll_payment_lines_bank_pair_check",
    "payroll_advances_deducted_bound_check",
  ])(
    "23514 `%s` (Zod đã mirror) ⇒ 400 VALIDATION-ERR-001 lưới cuối, KHÔNG 500 (plan-review B4)",
    (constraint) => {
      const e = mapPayrollPgError(
        wrapped({ code: "23514", constraint, message: `Failed query: params: ${FAKE_PARAM}` }),
      );
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as {
        code: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(body.code).toBe("VALIDATION-ERR-001");
      expect(body.details.find((d) => d.field === "constraint")?.message).toBe(constraint);
      expect(JSON.stringify(body)).not.toContain(FAKE_PARAM);
    },
  );

  it.each([
    "payroll_advances_user_id_fkey",
    "payroll_advances_user_id_company_fk",
    "payroll_payment_lines_user_id_company_fk",
    "payroll_budgets_org_unit_id_company_fk",
  ])(
    "23503 `%s` ⇒ 404 sentinel PAYROLL-ERR-010 (không tồn tại và khác tenant CÙNG một phản hồi)",
    (constraint) => {
      const e = mapPayrollPgError(wrapped({ code: "23503", constraint }));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(codeOf(e)).toBe("PAYROLL-ERR-010");
    },
  );

  it("ĐỐI CHỨNG: FK nội bộ track C (`payroll_payment_lines_batch_id_company_fk`) ⇒ null — bug server không che bằng 404", () => {
    expect(
      mapPayrollPgError(
        wrapped({ code: "23503", constraint: "payroll_payment_lines_batch_id_company_fk" }),
      ),
    ).toBeNull();
  });
});

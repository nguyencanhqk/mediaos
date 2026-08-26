import { describe, expect, it } from "vitest";
import { createRuleSchema, createShiftAssignmentSchema, scopeTargetMatches } from "./index";

/**
 * S10-ATT-SHIFTASSIGNSCOPE-1 (KI-080) — hợp đồng `scope` ↔ cột neo phải MIRROR 1:1 CHECK của DB.
 *
 * Trước bản vá, hai `.refine()` này chỉ kiểm chiều THUẬN ("Department/Employee phải có đúng id"),
 * nên tổ hợp mâu thuẫn theo chiều NGƯỢC (scope `Company` mà vẫn kèm id) lọt qua Zod, xuống DB và vỡ
 * CHECK ⇒ **500 SYSTEM-ERR-001** thay vì 400 ở biên.
 *
 * ⚠️ Bảng dưới đây là BẢNG CHÂN TRỊ của chính CHECK — mỗi ca DENY đi kèm ca ALLOW của cùng nhánh, để
 * không có nhánh nào xanh-RỖNG ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ⚠️ Nhánh `Employee` của CHECK KHÔNG cấm `department_id` ⇒ ca `Employee` + cả hai id phải ALLOW.
 * Đó KHÔNG phải sơ suất: contract chặt hơn CHECK là trôi theo chiều ngược lại (từ chối payload mà DB
 * chấp nhận). Muốn siết thì siết CHECK trước bằng migration.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("S10-ATT-SHIFTASSIGNSCOPE-1 — scopeTargetMatches mirror CHECK 1:1", () => {
  // (scope, departmentId, employeeId) → hợp lệ theo CHECK?
  const TRUTH_TABLE: Array<
    [
      "System" | "Company" | "Department" | "Employee",
      string | undefined,
      string | undefined,
      boolean,
    ]
  > = [
    ["Company", undefined, undefined, true],
    ["Company", UUID_A, undefined, false], // 🔴 chiều NGƯỢC — lọt trước bản vá
    ["Company", undefined, UUID_B, false], // 🔴 chính là KI-080
    ["Company", UUID_A, UUID_B, false],
    ["System", undefined, undefined, true],
    ["System", undefined, UUID_B, false], // 🔴 chỉ có ở attendance_rules
    ["Department", UUID_A, undefined, true],
    ["Department", undefined, undefined, false], // đã chặn từ trước
    ["Department", UUID_A, UUID_B, false], // 🔴 chiều NGƯỢC — lọt trước bản vá
    ["Employee", undefined, UUID_B, true],
    ["Employee", undefined, undefined, false], // đã chặn từ trước
    ["Employee", UUID_A, UUID_B, true], // CHECK CHO PHÉP — contract không được chặt hơn
  ];

  it.each(TRUTH_TABLE)("scope=%s dept=%s emp=%s ⇒ %s", (scope, dept, emp, expected) => {
    expect(scopeTargetMatches(scope, dept, emp)).toBe(expected);
  });

  it("null cũng là VẮNG, y như undefined (cột DB nullable)", () => {
    expect(scopeTargetMatches("Company", null, null)).toBe(true);
    expect(scopeTargetMatches("Company", null, UUID_B)).toBe(false);
    expect(scopeTargetMatches("Department", null, null)).toBe(false);
  });
});

describe("createShiftAssignmentSchema — scope ↔ neo", () => {
  const base = { shiftId: UUID_A, effectiveFrom: "2026-08-26" };

  it("ALLOW: scope khuyết ⇒ default 'Company', không kèm id", () => {
    const parsed = createShiftAssignmentSchema.parse({ ...base });
    expect(parsed.assignmentScope).toBe("Company");
  });

  it("ALLOW: scope 'Employee' + employeeId", () => {
    expect(() =>
      createShiftAssignmentSchema.parse({
        ...base,
        assignmentScope: "Employee",
        employeeId: UUID_B,
      }),
    ).not.toThrow();
  });

  it("ALLOW: scope 'Department' + departmentId", () => {
    expect(() =>
      createShiftAssignmentSchema.parse({
        ...base,
        assignmentScope: "Department",
        departmentId: UUID_B,
      }),
    ).not.toThrow();
  });

  /** 🔴 KI-080 — payload TỰ NHIÊN NHẤT: "gán ca này cho nhân viên này", quên `assignmentScope`. */
  it("REJECT: employeeId mà KHÔNG gửi assignmentScope (default 'Company') — KI-080", () => {
    const res = createShiftAssignmentSchema.safeParse({ ...base, employeeId: UUID_B });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["assignmentScope"]);
  });

  it("REJECT: scope 'Company' tường minh mà vẫn kèm employeeId", () => {
    expect(
      createShiftAssignmentSchema.safeParse({
        ...base,
        assignmentScope: "Company",
        employeeId: UUID_B,
      }).success,
    ).toBe(false);
  });

  it("REJECT: scope 'Company' tường minh mà vẫn kèm departmentId", () => {
    expect(
      createShiftAssignmentSchema.safeParse({
        ...base,
        assignmentScope: "Company",
        departmentId: UUID_B,
      }).success,
    ).toBe(false);
  });

  it("REJECT: scope 'Department' kèm CẢ employeeId (CHECK buộc employee_id IS NULL)", () => {
    expect(
      createShiftAssignmentSchema.safeParse({
        ...base,
        assignmentScope: "Department",
        departmentId: UUID_A,
        employeeId: UUID_B,
      }).success,
    ).toBe(false);
  });

  it("REJECT: scope 'Department' thiếu departmentId (chiều THUẬN — giữ nguyên)", () => {
    expect(
      createShiftAssignmentSchema.safeParse({ ...base, assignmentScope: "Department" }).success,
    ).toBe(false);
  });

  it("REJECT: scope 'Employee' thiếu employeeId (chiều THUẬN — giữ nguyên)", () => {
    expect(
      createShiftAssignmentSchema.safeParse({ ...base, assignmentScope: "Employee" }).success,
    ).toBe(false);
  });
});

describe("createRuleSchema — scope ↔ neo (bản sao cùng lớp, cách bản vá 60 dòng)", () => {
  const base = { ruleCode: "QT-001", name: "Quy tắc", effectiveFrom: "2026-08-26" };

  it("ALLOW: ruleScope khuyết ⇒ default 'Company', không kèm id", () => {
    expect(createRuleSchema.parse({ ...base }).ruleScope).toBe("Company");
  });

  it("ALLOW: ruleScope 'System' không kèm id", () => {
    expect(() => createRuleSchema.parse({ ...base, ruleScope: "System" })).not.toThrow();
  });

  it("ALLOW: ruleScope 'Employee' + employeeId", () => {
    expect(() =>
      createRuleSchema.parse({ ...base, ruleScope: "Employee", employeeId: UUID_B }),
    ).not.toThrow();
  });

  it("REJECT: employeeId mà KHÔNG gửi ruleScope (default 'Company')", () => {
    const res = createRuleSchema.safeParse({ ...base, employeeId: UUID_B });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["ruleScope"]);
  });

  it("REJECT: ruleScope 'System' mà vẫn kèm departmentId", () => {
    expect(
      createRuleSchema.safeParse({ ...base, ruleScope: "System", departmentId: UUID_A }).success,
    ).toBe(false);
  });

  it("REJECT: ruleScope 'Department' kèm CẢ employeeId", () => {
    expect(
      createRuleSchema.safeParse({
        ...base,
        ruleScope: "Department",
        departmentId: UUID_A,
        employeeId: UUID_B,
      }).success,
    ).toBe(false);
  });

  it("REJECT: ruleScope 'Employee' thiếu employeeId (chiều THUẬN — giữ nguyên)", () => {
    expect(createRuleSchema.safeParse({ ...base, ruleScope: "Employee" }).success).toBe(false);
  });
});

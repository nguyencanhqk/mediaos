import type { PayrollEmployeeDetailDto, PayrollEmployeeListItemDto } from "@mediaos/contracts";
import type { PayrollEmployeeRow } from "./payroll-employees.repository";
import type { PayrollPersonRef } from "./payroll.types";

/**
 * S15-PAYROLL-BE-1 — mapper 036/037.
 *
 * 🔴 **MASK = VẮNG KHOÁ, KHÔNG PHẢI `null`.** `taxCode` chỉ được **gắn khoá** khi caller thêm
 * `('view','salary-profile')`@Company (SPEC-11 §18.1 A hàng 2). Trả `taxCode: null` cho người không đủ
 * quyền là hai lỗi trong một: FE không phân biệt được "không có MST" với "không được xem MST", và nó
 * biến một quyết định quyền thành một giá trị dữ liệu (`server-masking-needs-optional-fe-schema`).
 * ⇒ spread có điều kiện, đúng khuôn `payroll.mapper.ts` của v1.
 *
 * `fullName`/`employeeCode` đến từ `PayrollPeopleRepository` (điểm chiếu danh tính DUY NHẤT), KHÔNG từ
 * `PayrollEmployeesRepository` — người không có trong map (khác tenant / xoá mềm) nhận `null`.
 */
export function toPayrollEmployeeListItem(
  row: PayrollEmployeeRow,
  person: PayrollPersonRef | undefined,
  canRevealTaxCode: boolean,
): PayrollEmployeeListItemDto {
  return {
    userId: row.userId,
    employeeCode: person?.employeeCode ?? null,
    fullName: person?.displayName ?? null,
    orgUnitName: row.orgUnitName,
    positionName: row.positionName,
    employeeStatus: row.employeeStatus,
    hasSalaryProfile: row.hasSalaryProfile,
    ...(canRevealTaxCode ? { taxCode: row.taxCode } : {}),
  };
}

export function toPayrollEmployeeDetail(
  row: PayrollEmployeeRow,
  person: PayrollPersonRef | undefined,
  canRevealTaxCode: boolean,
): PayrollEmployeeDetailDto {
  return {
    ...toPayrollEmployeeListItem(row, person, canRevealTaxCode),
    startDate: row.startDate,
  };
}

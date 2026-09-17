import { z } from "zod";
import { periodMonthSchema } from "./attendance";

/**
 * MediaOS — PAYROLL readiness + picker (PAYROLL-API-006 · 034 · 035, S13-PAYROLL-BE-1). Tách nguyên văn khỏi
 * `payroll.ts` (S15-PAYROLL-DEBT-1 — file đã vượt 800 dòng). Cùng luật tách file như `./payroll-employees`:
 * import NGƯỢC từ `./payroll`, KHÔNG re-export tên của nó.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. Readiness + picker — S13-PAYROLL-BE-1 (PAYROLL-API-006 · 034 · 035)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Hai loại cảnh báo dữ liệu thiếu (PAYROLL-FUNC-005). Cảnh báo là **MỀM** — không chặn `calculate`;
 * chỉ khi `eligibleCount = 0` thì `calculate` trả 422 PAYROLL-ERR-009.
 */
export const payrollReadinessWarningKindEnum = z.enum([
  "missing-salary-profile",
  "missing-attendance",
]);
export type PayrollReadinessWarningKind = z.infer<typeof payrollReadinessWarningKindEnum>;

export const payrollReadinessWarningSchema = z.object({
  userId: z.string().uuid(),
  /** Qua điểm chiếu danh tính DUY NHẤT `PayrollPeopleRepository`; `null` khi ngoài vị từ chiếu. */
  fullName: z.string().nullable(),
  kind: payrollReadinessWarningKindEnum,
});
export type PayrollReadinessWarningDto = z.infer<typeof payrollReadinessWarningSchema>;

/**
 * PAYROLL-API-006 — **KHÔNG khoá tiền nào** (gác bằng `('calculate','payroll-period')` là cặp GHI;
 * cặp ĐỌC tiền là `view-line`, SPEC-11 §11.1).
 *
 * ⚠️ Hình dạng cảnh báo ở ĐÂY (object có cấu trúc) **cố ý khác** `payrollWriteResultSchema.warnings`
 * (mảng CHUỖI tóm tắt của route GHI `collect`/`calculate`/`adjust-line`) — route ghi trả envelope tối
 * thiểu, màn readiness mới cần từng người.
 */
export const payrollReadinessSchema = z.object({
  eligibleCount: z.number().int().nonnegative(),
  warnings: z.array(payrollReadinessWarningSchema),
});
export type PayrollReadinessDto = z.infer<typeof payrollReadinessSchema>;

export const PAYROLL_PICKER_LIMIT_DEFAULT = 20;
export const PAYROLL_PICKER_LIMIT_MAX = 100;

/** PAYROLL-API-034 — danh bạ chọn nhân sự (`payroll-officer` KHÔNG có cặp HR ⇒ không dùng API-03). */
export const payrollPeoplePickerQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAYROLL_PICKER_LIMIT_MAX)
    .default(PAYROLL_PICKER_LIMIT_DEFAULT),
});
export type PayrollPeoplePickerQuery = z.infer<typeof payrollPeoplePickerQuerySchema>;

/** Trường bó HẸP — không `email`, không số điện thoại (SPEC-11 §18). */
export const payrollPersonRefSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().nullable(),
  employeeCode: z.string().nullable(),
});
export type PayrollPersonRefDto = z.infer<typeof payrollPersonRefSchema>;

/** mirror `att_periods_status_check` — chữ **thường** (`'open'/'locked'`, KHÔNG TitleCase). */
export const attendancePeriodStatusEnum = z.enum(["open", "locked"]);
export type AttendancePeriodStatus = z.infer<typeof attendancePeriodStatusEnum>;

/**
 * PAYROLL-API-035 — kỳ công để gắn vào kỳ lương. **BẮT BUỘC**, không phải tiện nghi:
 * `GET /attendance/periods` gác bằng `('read','attendance')` mà `payroll-officer` giữ **0 cặp ngoài
 * PAYROLL** (§9g) ⇒ thiếu route này thì PAYROLL-API-002/004 không dùng được.
 */
export const payrollAttendancePeriodPickerQuerySchema = z.object({
  status: attendancePeriodStatusEnum.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAYROLL_PICKER_LIMIT_MAX)
    .default(PAYROLL_PICKER_LIMIT_DEFAULT),
});
export type PayrollAttendancePeriodPickerQuery = z.infer<
  typeof payrollAttendancePeriodPickerQuerySchema
>;

export const payrollAttendancePeriodRefSchema = z.object({
  id: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: attendancePeriodStatusEnum,
});
export type PayrollAttendancePeriodRefDto = z.infer<typeof payrollAttendancePeriodRefSchema>;

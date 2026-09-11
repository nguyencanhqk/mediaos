import { z } from "zod";
import { dependentRelationshipEnum, payrollPageQuery } from "./payroll";

/**
 * MediaOS — PAYROLL **track A v2** contracts (SPEC-11 §15.1 `036..043` · API-18 §5b, wave S15-PAYROLL-V2).
 *
 * Hai luật của `payroll.ts` áp nguyên ở đây (mirror CHECK HAI CHIỀU · mask = **VẮNG KHOÁ**), cộng **ba
 * luật riêng của track A** vì đây là nơi PII mới của module đi qua (SPEC-11 §3.12):
 *
 * 1. 🔴 **KHÔNG BAO GIỜ có khoá `bankAccountNumber` trong bất kỳ DTO nào của file này.** Số tài khoản
 *    đầy đủ CHỈ rời server qua **tệp UNC** của `PAYROLL-API-071` (BE-4), gác BA cặp + audit bắt buộc.
 *    DTO đọc chỉ mang `bankAccountLast4` — **trường DẪN XUẤT do server tính**, KHÔNG phải cột (lưu thêm
 *    một cột 4-số-cuối là nhân đôi nguồn sự thật và mở đường cho hai bên lệch nhau — §18.1 A).
 * 2. 🔴 **Envelope GHI 039/041/042 = `{id, warnings}`, 0 khoá PII.** Căn cứ là **§3.12**: "NPT (họ tên ·
 *    MST NPT) **chỉ với** `('view','payroll-employee')`". Một role giữ `manage` mà không giữ `view`
 *    KHÔNG có đường hợp lệ nào để đọc NPT — trả PII trong phản hồi GHI là mở đúng cửa sau đó. (Invariant
 *    seed `manage ⇒ view` của §11.3 ghi chú 7 **không phủ** `payroll-employee`, nên chốt ở tầng DTO.)
 * 3. **`taxCode` `.optional()`** — 037 chỉ gắn khoá này khi caller **thêm** `('view','salary-profile')`
 *    ở scope Company (§18.1 A hàng 2); thiếu ⇒ **vắng khoá**, route vẫn 200.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. PAYROLL-API-036/037 — nhân sự hưởng lương (chiếu HR bó hẹp, PAY-DEC-016)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** GET /payroll/employees (036) — filter + pagination. */
export const payrollEmployeeListQuerySchema = z.object({
  /** Tìm theo họ tên hoặc mã nhân viên. */
  q: z.string().trim().min(1).max(100).optional(),
  /**
   * Lọc CHÍNH XÁC một đơn vị, **KHÔNG đệ quy cây con** (plan §9 mục 3 — SPEC không chốt; đệ quy là
   * quyết định cần ký riêng, và mở rộng ngầm thì không ai đo được lúc nào phạm vi đổi).
   */
  orgUnitId: z.string().uuid().optional(),
  /** `true` = chỉ nhân sự đã có ≥1 phiên bản hồ sơ lương chưa xoá mềm (không xét ngày hiệu lực). */
  hasSalaryProfile: z.coerce.boolean().optional(),
  ...payrollPageQuery,
});
export type PayrollEmployeeListQuery = z.infer<typeof payrollEmployeeListQuerySchema>;

/**
 * Hàng danh sách 036 — **chiếu HR BÓ HẸP**: đúng 5 trường + `taxCode` có điều kiện.
 * KHÔNG `email`, KHÔNG số điện thoại, KHÔNG lương (SPEC-11 §18).
 */
export const payrollEmployeeListItemSchema = z.object({
  userId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  positionName: z.string().nullable(),
  employeeStatus: z.string().nullable(),
  hasSalaryProfile: z.boolean(),
  /** Chỉ có mặt khi caller thêm `('view','salary-profile')`@Company — §18.1 A. */
  taxCode: z.string().nullable().optional(),
});
export type PayrollEmployeeListItemDto = z.infer<typeof payrollEmployeeListItemSchema>;

/**
 * GET /payroll/employees/:userId (037) — tab «Thông tin chung»: cùng bộ trường của list + ngày vào làm.
 *
 * Phạm vi trường ĐÓNG ở đây (plan §9 mục 1): SPEC-11 chỉ nói "tab Thông tin chung" chung chung, nên
 * BE-1 hiện thực đúng những trường đã chốt được từ §15.1/§18.1 và KHÔNG đoán thêm (ngày hết hạn hợp
 * đồng, loại hợp đồng…). FE-1 cần thêm thì yêu cầu tường minh — thêm trường HR vào chiếu này là mở
 * rộng bề mặt PII, phải đi qua gate chứ không "tiện thì lấy luôn".
 */
export const payrollEmployeeDetailSchema = payrollEmployeeListItemSchema.extend({
  /** `employee_profiles.start_date` — ngày vào làm. */
  startDate: z.string().date().nullable(),
});
export type PayrollEmployeeDetailDto = z.infer<typeof payrollEmployeeDetailSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. PAYROLL-API-038/039 — thiết lập BH · công đoàn · tài khoản ngân hàng
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DTO đọc (038). ⚠️ **`bankAccountLast4`, KHÔNG BAO GIỜ `bankAccountNumber`** (§3.12 · §18.1 A).
 * Hàng có thể CHƯA tồn tại (1 hàng/nhân sự, tạo lần đầu ở 039) ⇒ mọi trường nullable, `id` cũng vậy.
 */
export const payrollEmployeeSettingsSchema = z.object({
  userId: z.string().uuid(),
  joinsSocialInsurance: z.boolean(),
  socialInsuranceNo: z.string().nullable(),
  joinsUnion: z.boolean(),
  /** 4 số cuối — trường DẪN XUẤT do server cắt, KHÔNG phải cột. */
  bankAccountLast4: z.string().nullable(),
  bankName: z.string().nullable(),
  bankBranch: z.string().nullable(),
  accountHolder: z.string().nullable(),
});
export type PayrollEmployeeSettingsDto = z.infer<typeof payrollEmployeeSettingsSchema>;

/**
 * PUT /payroll/employees/:userId/settings (039) — upsert 1 hàng/nhân sự.
 *
 * `.refine` mirror CHECK `payroll_employee_settings_bank_pair_check`: số TK mà thiếu tên ngân hàng
 * hoặc tên chủ TK là **một dòng UNC KHÔNG GỬI ĐƯỢC**. Zod là lưới ĐẦU (400 đọc được), CHECK ở DB là
 * lưới CUỐI. `bankBranch` cố ý LỎNG — nhiều ngân hàng không cần chi nhánh (DB-13 §13.2).
 *
 * 🔴 **`.min(1)` trên `bankAccountNumber` là BẮT BUỘC, không phải trang trí** (security review
 * S15-PAYROLL-BE-1, HIGH #2): CHECK ở DB phân biệt theo `IS NULL`, còn `.refine` phân biệt theo
 * *truthy*. Không có `.min(1)` thì `bankAccountNumber: ""` **lọt refine** (vì `!"" === true`) rồi ghi
 * xuống DB một hàng `bank_account_number = ''` NOT NULL — CHECK coi là "CÓ số TK" và đòi hai trường
 * kia, còn mapper coi là "KHÔNG có" (`"" ? … : null`). Hai tầng đọc cùng một hàng ra hai nghĩa.
 *
 * ⚠️ **`.refine` này chỉ phủ PAYLOAD.** 039 là **upsert MERGE từng phần**, nên CHECK ở DB chạy trên
 * hàng **SAU MERGE**: gửi `{bankName: null}` lên một nhân sự ĐÃ có số TK thì payload tự nó hợp lệ mà
 * hàng sau merge thì không. Vế đó **PHẢI** kiểm ở service (`assertBankPairOnMergedRow`) — Zod không
 * nhìn thấy hàng hiện có.
 */
export const putPayrollEmployeeSettingsSchema = z
  .object({
    joinsSocialInsurance: z.boolean().default(false),
    socialInsuranceNo: z.string().max(50).nullable().optional(),
    joinsUnion: z.boolean().default(false),
    bankAccountNumber: z.string().min(1).max(50).nullable().optional(),
    bankName: z.string().max(200).nullable().optional(),
    bankBranch: z.string().max(200).nullable().optional(),
    accountHolder: z.string().max(200).nullable().optional(),
  })
  .strict()
  .refine((v) => !v.bankAccountNumber || (!!v.bankName && !!v.accountHolder), {
    message: "bankAccountNumber đòi CẢ bankName lẫn accountHolder",
    path: ["bankAccountNumber"],
  });
export type PutPayrollEmployeeSettingsRequest = z.infer<typeof putPayrollEmployeeSettingsSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. PAYROLL-API-040/041/042 — người phụ thuộc giảm trừ TNCN
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** DTO đọc (040) — `fullName`/`dependentTaxCode` là **PII**, chỉ ra qua `('view','payroll-employee')`. */
export const payrollDependentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string(),
  relationship: dependentRelationshipEnum,
  dependentTaxCode: z.string().nullable(),
  dateOfBirth: z.string().date().nullable(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable(),
});
export type PayrollDependentDto = z.infer<typeof payrollDependentSchema>;

/**
 * POST …/dependents (041). `effectiveTo >= effectiveFrom` mirror CHECK `payroll_dependents_period_check`;
 * chồng lấp cùng `fullName` ⇒ **409 PAYROLL-ERR-032** (chốt cuối `EXCLUDE USING gist`, `23P01`).
 */
export const createPayrollDependentSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    relationship: dependentRelationshipEnum,
    dependentTaxCode: z.string().max(20).nullable().optional(),
    dateOfBirth: z.string().date().nullable().optional(),
    effectiveFrom: z.string().date(),
    effectiveTo: z.string().date().nullable().optional(),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: "effectiveTo phải >= effectiveFrom",
    path: ["effectiveTo"],
  });
export type CreatePayrollDependentRequest = z.infer<typeof createPayrollDependentSchema>;

/**
 * PATCH /payroll/dependents/:id (042) — sửa **hoặc** xoá mềm (`{delete:true}`).
 *
 * ⚠️ Không `.refine` cặp ngày ở đây được: PATCH có thể gửi MỘT vế, vế kia nằm ở hàng DB. Service so
 * với giá trị **sau khi merge** rồi mới ghi; CHECK ở DB là lưới cuối.
 */
export const updatePayrollDependentSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    relationship: dependentRelationshipEnum.optional(),
    dependentTaxCode: z.string().max(20).nullable().optional(),
    dateOfBirth: z.string().date().nullable().optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    delete: z.literal(true).optional(),
  })
  .strict();
export type UpdatePayrollDependentRequest = z.infer<typeof updatePayrollDependentSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. PAYROLL-API-043 — bảng công tổng hợp kỳ (KHÔNG số tiền)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** GET /payroll-periods/:id/timesheet (043) — chỉ pagination, không filter (bảng của KỲ). */
export const payrollTimesheetQuerySchema = z.object({ ...payrollPageQuery });
export type PayrollTimesheetQuery = z.infer<typeof payrollTimesheetQuerySchema>;

/**
 * Hàng bảng công. **KHÔNG có trường tiền nào** — đây là số NGÀY và số PHÚT.
 * `workDays` là hằng của KỲ (mẫu số), lặp trên mọi hàng để FE không phải ghép hai nguồn.
 */
export const payrollTimesheetRowSchema = z.object({
  userId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  workDays: z.number(),
  presentDays: z.number(),
  paidLeaveDays: z.number(),
  unpaidLeaveDays: z.number(),
  lateMinutes: z.number(),
});
export type PayrollTimesheetRowDto = z.infer<typeof payrollTimesheetRowSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. Envelope GHI track A — 0 khoá PII (xem luật 2 ở đầu file)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Phản hồi của 039 · 041 · 042. Khuôn `payrollWriteResultSchema` của v1 nhưng cho PII thay vì tiền:
 * **không** `fullName`, **không** `dependentTaxCode`, **không** `bankAccount*`. FE tải lại qua route ĐỌC
 * (038 / 040) — route ĐỌC gác bằng `('view','payroll-employee')`, đúng cặp mà §3.12 đòi.
 */
export const payrollEmployeeWriteResultSchema = z.object({
  id: z.string().uuid(),
  warnings: z.array(z.string()).default([]),
});
export type PayrollEmployeeWriteResultDto = z.infer<typeof payrollEmployeeWriteResultSchema>;

/**
 * S13-PAYROLL-FE-1 — hằng số module Tiền lương (SPEC-11). Cặp quyền engine THẬT + hằng dùng chung.
 *
 * `PAYROLL_ENGINE_PAIRS` MIRROR ĐÚNG bảng 35 route của `apps/api/src/payroll/payroll-route-pairs.const.ts`
 * (nguồn sự thật cho CẢ HAI tầng census BE) — copy literal, KHÔNG import chéo package (`apps/app` không
 * import được `apps/api`). `payroll-wiring.spec.ts` đọc lại file BE bằng `fs` và so KHỚP TỪNG TRƯỜNG với
 * bảng này để bắt drift — khuôn `RECRUIT_ENGINE_PAIRS`/`ASSET_ENGINE_PAIRS`.
 *
 * ⚠️ **13 cặp `isSensitive` PHẢI gate bằng `useCanExact`, KHÔNG phải `useCan`.** `/auth/me` lọc bỏ mọi
 * cặp `is_sensitive` khỏi capabilities trừ những cặp nằm trong `SENSITIVE_CAPABILITY_ALLOWLIST` của BE
 * (cả 13 cặp PAYROLL đã ở đó, seed `0565` + allowlist BE-1) — và wildcard `*:*` **KHÔNG kế thừa** cặp
 * sensitive. Dùng `useCan` cho một cặp sensitive là hoặc mở nhầm cho wildcard, hoặc ẩn màn với đúng vai
 * được cấp quyền (`capability-allowlist-hides-admin-screens`).
 *
 * `companyFloor` của BE (sàn scope Company) KHÔNG mirror ở FE — đó là ràng buộc server tính khi giải
 * quyền; FE chỉ hiển thị cái server trả về, không tự suy diễn scope (`dash-widget-gate-needs-scope-floor`).
 */

export interface PayrollEnginePair {
  readonly action: string;
  readonly resourceType: string;
  readonly isSensitive: boolean;
}

const pair = (action: string, resourceType: string, isSensitive = false): PayrollEnginePair => ({
  action,
  resourceType,
  isSensitive,
});

/** Key = mã route API-18 (PAYROLL-API-XXX), ĐÚNG 35 khoá như BE. */
export const PAYROLL_ENGINE_PAIRS = {
  // Kỳ lương 001–018
  periodList: pair("view", "payroll-period"),
  periodCreate: pair("manage", "payroll-period"),
  periodDetail: pair("view", "payroll-period"),
  periodUpdate: pair("manage", "payroll-period"),
  periodCollect: pair("calculate", "payroll-period", true),
  periodReadiness: pair("calculate", "payroll-period", true),
  periodCalculate: pair("calculate", "payroll-period", true),
  periodLines: pair("view-line", "payroll-period", true),
  periodAdjustLine: pair("calculate", "payroll-period", true),
  periodSubmit: pair("calculate", "payroll-period", true),
  periodApprove: pair("approve", "payroll-period", true),
  periodReject: pair("approve", "payroll-period", true),
  periodGeneratePayslips: pair("publish", "payroll-period", true),
  periodPublish: pair("publish", "payroll-period", true),
  periodLock: pair("manage", "payroll-period"),
  periodReopen: pair("reopen", "payroll-period", true),
  periodExport: pair("export", "payroll", true),
  periodSummary: pair("view-line", "payroll-period", true),
  // Hồ sơ lương 019–022
  salaryProfileList: pair("view", "salary-profile", true),
  salaryProfileCreate: pair("manage", "salary-profile", true),
  salaryProfileDetail: pair("view", "salary-profile", true),
  salaryProfileUpdate: pair("manage", "salary-profile", true),
  // Thưởng/phạt 023–028
  bonusPenaltyList: pair("view", "bonus-penalty", true),
  bonusPenaltyCreate: pair("manage", "bonus-penalty", true),
  bonusPenaltyDetail: pair("view", "bonus-penalty", true),
  bonusPenaltyUpdate: pair("manage", "bonus-penalty", true),
  bonusPenaltyApprove: pair("approve", "bonus-penalty", true),
  bonusPenaltyReject: pair("approve", "bonus-penalty", true),
  // Phiếu lương 029–033
  payslipList: pair("view-payslip", "payslip", true),
  payslipDetail: pair("view-payslip", "payslip", true),
  mePayslipList: pair("view-own-payslip", "payslip", true),
  mePayslipDetail: pair("view-own-payslip", "payslip", true),
  mePayslipAck: pair("acknowledge-own-payslip", "payslip"),
  // Picker 034–035
  pickerPeople: pair("view", "salary-profile", true),
  pickerAttendancePeriods: pair("manage", "payroll-period"),
  // ── S15-PAYROLL-BE-1 · track A 036–043 ────────────────────────────────────────────────────────
  // CẢ HAI cặp `payroll-employee` là `is_sensitive` (SPEC-11 §11.3 — 17 cặp mới đều sensitive).
  employeeList: pair("view", "payroll-employee", true),
  employeeDetail: pair("view", "payroll-employee", true),
  employeeSettingsGet: pair("view", "payroll-employee", true),
  employeeSettingsPut: pair("manage", "payroll-employee", true),
  employeeDependentList: pair("view", "payroll-employee", true),
  employeeDependentCreate: pair("manage", "payroll-employee", true),
  dependentUpdate: pair("manage", "payroll-employee", true),
  // 043 tái dùng cặp CŨ `view-line:payroll-period` (bảng công là dữ liệu của KỲ).
  periodTimesheet: pair("view-line", "payroll-period", true),
  // S15-PAYROLL-BE-2 · track B 044–058 — catalog thành phần · mẫu bảng lương · tỉ lệ luật định (cả 6 cặp sensitive).
  componentList: pair("view", "salary-component", true),
  componentCreate: pair("manage", "salary-component", true),
  componentDetail: pair("view", "salary-component", true),
  componentUpdate: pair("manage", "salary-component", true),
  // 048 gác cặp GHI (kiểm công thức là bước của luồng sửa, không phải đọc).
  componentValidateFormula: pair("manage", "salary-component", true),
  templateList: pair("view", "payroll-template", true),
  templateCreate: pair("manage", "payroll-template", true),
  templateDetail: pair("view", "payroll-template", true),
  templateUpdate: pair("manage", "payroll-template", true),
  templatePutComponents: pair("manage", "payroll-template", true),
  // 054 gác cặp GHI — xem trước là bước soạn mẫu.
  templatePreview: pair("manage", "payroll-template", true),
  statutoryRateList: pair("view", "statutory-rate", true),
  statutoryRateCreate: pair("manage", "statutory-rate", true),
  statutoryRateDetail: pair("view", "statutory-rate", true),
  statutoryRateUpdate: pair("manage", "statutory-rate", true),
  // S15-PAYROLL-BE-4 · track C 059–077 — tạm ứng · đợt chi trả · ngân sách · import (8 cặp mới, TẤT CẢ sensitive).
  advanceList: pair("view", "payroll-advance", true),
  advanceCreate: pair("manage", "payroll-advance", true),
  advanceDetail: pair("view", "payroll-advance", true),
  advanceUpdate: pair("manage", "payroll-advance", true),
  advanceApprove: pair("approve", "payroll-advance", true),
  advanceReject: pair("approve", "payroll-advance", true),
  // 065 Own — «Tạm ứng của tôi» (gate `access:me`, KHÔNG sau cổng payroll — cùng khuôn me.payslips).
  meAdvanceList: pair("view-own", "payroll-advance", true),
  batchList: pair("view", "payment-batch", true),
  batchCreate: pair("manage", "payment-batch", true),
  batchDetail: pair("view", "payment-batch", true),
  batchUpdate: pair("manage", "payment-batch", true),
  batchLines: pair("view", "payment-batch", true),
  // 071 tệp UNC: BE assert THÊM `export:payroll` + `view-payslip:payslip` — FE gate nút tải bằng CẢ BA (useCanExact).
  batchExport: pair("manage", "payment-batch", true),
  batchComplete: pair("manage", "payment-batch", true),
  budgetList: pair("view", "payroll-budget", true),
  budgetCreate: pair("manage", "payroll-budget", true),
  budgetUpdate: pair("manage", "payroll-budget", true),
  // 076/077 tái dùng cặp CŨ `manage:bonus-penalty`.
  importAdjustments: pair("manage", "bonus-penalty", true),
  importTemplate: pair("manage", "bonus-penalty", true),
} as const satisfies Record<string, PayrollEnginePair>;

export type PayrollEngineKey = keyof typeof PAYROLL_ENGINE_PAIRS;

/**
 * Cặp cổng nav/capability của khối «Phiếu lương của tôi» — **KHÔNG gác route nào ở BE** (17 cặp SPEC-11
 * §11.1 nhưng chỉ 16 cặp có route). Giữ ở đây để `payroll-wiring.spec.ts` neo được rằng nó CỐ Ý vắng
 * khỏi bảng 35 route, thay vì im lặng biến mất.
 */
export const PAYROLL_ACCESS_PAIR = pair("access", "payroll");

/**
 * 8 trạng thái kỳ lương theo thứ tự vòng đời (SPEC-01 §17.15, v2 mig `0572`) — dùng cho bộ lọc + chip.
 * `Published` = đã phát hành phiếu; `Paid` = đã chi trả xong (chỉ tới được qua hoàn tất đợt chi trả).
 */
export const PAYROLL_PERIOD_STATUSES = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Published",
  "Paid",
  "Locked",
] as const;

/** 3 trạng thái thưởng/phạt (SPEC-01 §17.17). */
export const BONUS_PENALTY_STATUSES = ["Pending", "Approved", "Rejected"] as const;

/**
 * S15-PAYROLL-FE-3 — 4 trạng thái tạm ứng, mirror `payrollAdvanceStatusEnum` của contracts
 * (= CHECK `payroll_advances_status_check`). `Deducted` là trạng thái CUỐI do máy tính lương đặt khi
 * khoản đã vào phiếu — không có nút nào của FE đưa tới nó.
 */
export const PAYROLL_ADVANCE_STATUSES = ["Pending", "Approved", "Rejected", "Deducted"] as const;

/**
 * S15-PAYROLL-FE-3 — 3 trạng thái đợt chi trả, mirror `paymentBatchStatusEnum`.
 * ⚠️ `Completed` **không** đặt được qua PATCH 069 (enum body RIÊNG `Draft|Ready`) — chỉ 072 tới được.
 */
export const PAYMENT_BATCH_STATUSES = ["Draft", "Ready", "Completed"] as const;

/** S15-PAYROLL-FE-3 — hình thức chi trả, mirror `paymentBatchMethodEnum`. */
export const PAYMENT_BATCH_METHODS = ["bank", "cash"] as const;

/** Trần trang mặc định — khớp `PAYROLL_PAGE_DEFAULT` của contracts (max 100). */
export const PAYROLL_PAGE_SIZE = 20;

/** Trần dòng của một lượt export XLSX — khớp cổng 422 `PAYROLL-ERR-016` ở BE. */
export const PAYROLL_EXPORT_ROW_CAP = 10_000;

type BadgeVariant = "success" | "brand" | "warning" | "muted" | "danger";

export const PAYROLL_PERIOD_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  Draft: "muted",
  CollectingData: "brand",
  Calculated: "brand",
  Reviewing: "warning",
  Approved: "success",
  Published: "brand",
  Paid: "success",
  Locked: "muted",
};

/** Trạng thái phiếu lương là **DẪN XUẤT** (SPEC-11 §13.2) — server tính, FE chỉ tô màu. */
export const PAYSLIP_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  Generated: "muted",
  Published: "brand",
  Acknowledged: "success",
};

export const BONUS_PENALTY_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
};

/** S15-PAYROLL-FE-3 — tạm ứng. `Deducted` trung tính: đã xong vòng đời, không phải "thành công" mới. */
export const PAYROLL_ADVANCE_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
  Deducted: "muted",
};

/** S15-PAYROLL-FE-3 — đợt chi trả. `Completed` là terminal (trigger DB đóng băng đợt). */
export const PAYMENT_BATCH_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  Draft: "muted",
  Ready: "warning",
  Completed: "success",
};

export const BONUS_KIND_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  bonus: "success",
  penalty: "danger",
};

// ── S15-PAYROLL-FE-1 — PAY-SCREEN-007/008 ──────────────────────────────────────────────────────

/**
 * Trạng thái nhân sự chiếu từ HR (`employee_profiles.status`, CHECK `emp_status_check` — đo
 * `db/schema/employees.ts:110`). Giá trị lạ ⇒ `muted` + hiện nguyên chuỗi, KHÔNG bịa nhãn.
 */
export const EMPLOYEE_STATUS_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  active: "success",
  inactive: "warning",
  resigned: "muted",
  terminated: "danger",
};

/** 5 tab của chi tiết nhân sự (SPEC-11 §9.1, PAY-DEC-016) — thứ tự hiển thị. Gate TỪNG tab ở page. */
export const PAYROLL_EMPLOYEE_TABS = [
  "general",
  "salaryHistory",
  "insurance",
  "tax",
  "dependents",
] as const;
export type PayrollEmployeeTab = (typeof PAYROLL_EMPLOYEE_TABS)[number];

/** Hai tab của chi tiết kỳ: bảng lương (PAY-SCREEN-002) · bảng công (PAY-SCREEN-008, route riêng). */
export type PayrollPeriodTab = "lines" | "timesheet";

/**
 * Trần trang khi tải catalog thành phần lương cho picker `items[]` = `PAYROLL_PAGE_MAX` của contracts.
 * Catalog `profile_item` của một công ty hiếm khi quá vài chục mã; vượt 100 thì picker THIẾU mã (hiện
 * cảnh báo), không lật trang trong dialog.
 */
export const SALARY_COMPONENT_CATALOG_PAGE = 100;

/** Trần phiên bản hồ sơ lương tải cho timeline «Lịch sử lương» (một người hiếm khi > 100 phiên bản). */
export const SALARY_HISTORY_PAGE = 100;

/**
 * S15-PAYROLL-FE-2 — bộ lọc 049 cho picker «mẫu gắn vào kỳ»: đang dùng + phạm vi TOÀN CÔNG TY (`org_unit` ⇒
 * 409 `template-scope-unsupported`, không mời). Dùng chung cho form tạo kỳ và khối mẫu ở chi tiết kỳ (một
 * khoá cache).
 */
export const BINDABLE_TEMPLATE_QUERY = {
  isActive: true,
  scope: "company",
  page: 1,
  per_page: SALARY_COMPONENT_CATALOG_PAGE,
} as const;

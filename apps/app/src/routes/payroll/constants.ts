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
} as const satisfies Record<string, PayrollEnginePair>;

export type PayrollEngineKey = keyof typeof PAYROLL_ENGINE_PAIRS;

/**
 * Cặp cổng nav/capability của khối «Phiếu lương của tôi» — **KHÔNG gác route nào ở BE** (17 cặp SPEC-11
 * §11.1 nhưng chỉ 16 cặp có route). Giữ ở đây để `payroll-wiring.spec.ts` neo được rằng nó CỐ Ý vắng
 * khỏi bảng 35 route, thay vì im lặng biến mất.
 */
export const PAYROLL_ACCESS_PAIR = pair("access", "payroll");

/** 7 trạng thái kỳ lương theo thứ tự vòng đời (SPEC-01 §17.15) — dùng cho bộ lọc + chip. */
export const PAYROLL_PERIOD_STATUSES = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Paid",
  "Locked",
] as const;

/** 3 trạng thái thưởng/phạt (SPEC-01 §17.17). */
export const BONUS_PENALTY_STATUSES = ["Pending", "Approved", "Rejected"] as const;

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

export const BONUS_KIND_BADGE_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  bonus: "success",
  penalty: "danger",
};

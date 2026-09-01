/**
 * S13-PAYROLL-BE-1 — BẢNG HẰNG route → cặp quyền, NGUỒN SỰ THẬT DUY NHẤT cho CẢ BA nơi (plan §4):
 *   1. `@RequirePermission(PAIR.action, PAIR.resourceType, { isSensitive: PAIR.isSensitive })` ở route.
 *   2. Assert tầng THỨ HAI trong service qua `PayrollAccessService.resolveActor` (không gõ lại literal).
 *   3. `peopleVisibleCond` tính MỘT LẦN/request theo cặp CỦA ROUTE (điểm chiếu danh tính).
 *
 * Census 2 tầng (`payroll-two-layer-guard-census.unit-spec.ts`) so CẢ decorator lẫn service với CHÍNH
 * bảng này — KHÔNG so tầng-với-tầng (hai tầng cùng sai vẫn "khớp nhau").
 *
 * ⚠️ **Khai đủ 35 key NGAY Ở BE-1** (17 key của BE-2 khi đó chưa có route — đã nối dây hết ở BE-2),
 * và khai đủ **BA cờ cuối cùng** (`isSensitive` · `companyFloor` · `objectGrantRequired`) ngay từ đây.
 * Lý do (plan §1 B8, plan-review vòng 1 blocker #4): const này đi qua FULL gate **bây giờ**; để mặc
 * định `companyFloor = true` cho 3 route `/me/payslips*` (scope **Own** — SPEC-11 §13.5) thì hoặc BE-2
 * phải mở lại file đã ký, hoặc nhân viên **403 trên phiếu của chính mình**.
 *
 * 17 cặp PAYROLL (SPEC-11 §11.1) nhưng chỉ **16 cặp có route** — `('access','payroll')` là cổng
 * nav/capability của khối «Phiếu lương của tôi» trong app ME, KHÔNG gác route nào ở đây.
 * 13 cặp `is_sensitive = true` (seed mig `0565`): mọi `permission.can()` cho chúng phải truyền
 * `isSensitive: true` TƯỜNG MINH — wildcard `*:*` không thoả cổng sensitive.
 */
export interface PayrollPair {
  readonly action: string;
  readonly resourceType: string;
  /** true = cặp nằm trong 13 cặp `is_sensitive` của mig `0565`. */
  readonly isSensitive: boolean;
  /**
   * SÀN SCOPE Company (khuôn `dash-widget-gate-needs-scope-floor` / RECRUIT M1): SPEC-11 §13.5 chốt
   * kỳ lương · dòng · hồ sơ lương · thưởng/phạt **mọi grant đều Company** — grant hẹp hơn phải bị TỪ
   * CHỐI 403 chứ không "coi như" Company, kẻo một lần đổi `data_scope` per-pair âm thầm nới quyền.
   * `false` CHỈ cho 3 route `/me/payslips*` (Own hợp lệ).
   */
  readonly companyFloor: boolean;
  /**
   * TƯỜNG MINH `false` = KHÔNG đòi hàng `object_permissions` cấp-đối-tượng (bẫy ghi trong chính mig
   * `0180`): nhân viên có company-grant vẫn **403 trên phiếu của chính mình** nếu cờ này bật.
   *
   * ⚠️ **KHÔNG BAO GIỜ khai `true` ở đây.** `permission.decide.ts:93` tính
   * `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`, và `:96` trả
   * **`deny-object-required` fail-closed** khi cờ bật mà không có object-ALLOW khớp — kể cả
   * super-admin `*:*`. Khai `true` cho một cặp PAYROLL thường = **403 cả route** với chính vai được
   * cấp quyền. `undefined` = giữ ngữ nghĩa mặc định của engine, và đó là điều `('view-payslip',
   * 'payslip')` cần (object-permission override hiện hành do `permission-admin` cấp/thu theo đối tượng).
   */
  readonly objectGrantRequired?: false;
}

const pair = (
  action: string,
  resourceType: string,
  isSensitive = false,
  companyFloor = true,
  /** Chỉ nhận `false` hoặc bỏ trống — xem JSDoc trên. */
  objectGrantRequired?: false,
): PayrollPair => ({
  action,
  resourceType,
  isSensitive,
  companyFloor,
  ...(objectGrantRequired === false ? { objectGrantRequired: false as const } : {}),
});

/** Key = mã route API-18 (PAYROLL-API-XXX) — đủ **35** route. */
export const PAYROLL_ROUTE_PAIRS = {
  // ── Kỳ lương 001–018 ──────────────────────────────────────────────────────────────────────────
  periodList: pair("view", "payroll-period"), //                                            001
  periodCreate: pair("manage", "payroll-period"), //                                        002
  periodDetail: pair("view", "payroll-period"), //                                          003
  periodUpdate: pair("manage", "payroll-period"), //                                        004
  periodCollect: pair("calculate", "payroll-period", true), //                              005
  periodReadiness: pair("calculate", "payroll-period", true), //                            006
  periodCalculate: pair("calculate", "payroll-period", true), //                            007  BE-2
  periodLines: pair("view-line", "payroll-period", true), //                                008  BE-2
  periodAdjustLine: pair("calculate", "payroll-period", true), //                           009  BE-2
  periodSubmit: pair("calculate", "payroll-period", true), //                               010  BE-2
  periodApprove: pair("approve", "payroll-period", true), //                                011  BE-2
  periodReject: pair("approve", "payroll-period", true), //                                 012  BE-2
  periodGeneratePayslips: pair("publish", "payroll-period", true), //                       013  BE-2
  periodPublish: pair("publish", "payroll-period", true), //                                014  BE-2
  periodLock: pair("manage", "payroll-period"), //                                          015  BE-2
  periodReopen: pair("reopen", "payroll-period", true), //                                  016  BE-2
  periodExport: pair("export", "payroll", true), //                                         017  BE-2
  periodSummary: pair("view-line", "payroll-period", true), //                              018  BE-2
  // ── Hồ sơ lương 019–022 ───────────────────────────────────────────────────────────────────────
  salaryProfileList: pair("view", "salary-profile", true), //                               019
  salaryProfileCreate: pair("manage", "salary-profile", true), //                           020
  salaryProfileDetail: pair("view", "salary-profile", true), //                             021
  salaryProfileUpdate: pair("manage", "salary-profile", true), //                           022
  // ── Thưởng/phạt 023–028 ───────────────────────────────────────────────────────────────────────
  bonusPenaltyList: pair("view", "bonus-penalty", true), //                                 023
  bonusPenaltyCreate: pair("manage", "bonus-penalty", true), //                             024
  bonusPenaltyDetail: pair("view", "bonus-penalty", true), //                               025
  bonusPenaltyUpdate: pair("manage", "bonus-penalty", true), //                             026
  bonusPenaltyApprove: pair("approve", "bonus-penalty", true), //                           027
  bonusPenaltyReject: pair("approve", "bonus-penalty", true), //                            028
  // ── Phiếu lương 029–033 ───────────────────────────────────────────────────────────────────────
  payslipList: pair("view-payslip", "payslip", true), //                                    029  BE-2
  payslipDetail: pair("view-payslip", "payslip", true), //                                  030  BE-2
  // 3 route Own — sàn Company TẮT, object-grant TẮT (xem JSDoc `PayrollPair`).
  mePayslipList: pair("view-own-payslip", "payslip", true, false, false), //                031  BE-2
  mePayslipDetail: pair("view-own-payslip", "payslip", true, false, false), //              032  BE-2
  // `acknowledge-own-payslip` KHÔNG nhạy cảm (không chở số tiền) — SPEC-11 §11.1.
  mePayslipAck: pair("acknowledge-own-payslip", "payslip", false, false, false), //         033  BE-2
  // ── Picker 034–035 ────────────────────────────────────────────────────────────────────────────
  pickerPeople: pair("view", "salary-profile", true), //                                    034
  pickerAttendancePeriods: pair("manage", "payroll-period"), //                             035
} as const satisfies Record<string, PayrollPair>;

export type PayrollRouteKey = keyof typeof PAYROLL_ROUTE_PAIRS;

/**
 * **RỖNG từ `S13-PAYROLL-BE-2`** — cả 35 key đã có route và đã được assert ở tầng service.
 *
 * Hằng GIỮ LẠI, không xoá: census 2 tầng assert `PENDING_BE2 ∪ used === all` **VÀ**
 * `PENDING_BE2 ∩ used === ∅`, nên nó vẫn là cổng cho route thứ 36 mọc lên sau này mà quên nối tầng 2.
 *
 * ⚠️ Khi danh sách rỗng, neo chống-xanh-rỗng của CHÍNH nó biến mất ⇒ census phải neo bằng
 * `Object.keys(PAYROLL_ROUTE_PAIRS).length === 35` **và** `used.size === 35`. **Cấm hạ neo để lấy
 * màu xanh.**
 */
export const PAYROLL_PENDING_BE2: readonly PayrollRouteKey[] = [];

/** Trần QUÉT của 2 picker — chặn full-table-scan không giới hạn ở tenant lớn. */
export const PAYROLL_PICKER_SCAN_CAP = 1000;

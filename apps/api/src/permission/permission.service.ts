import { Injectable, Logger } from "@nestjs/common";
import { type DataScope } from "@mediaos/contracts";
import type {
  BatchActionSpec,
  BatchDecisions,
  CanInput,
  CompanyRoleGrant,
  IPermissionRepository,
  PermissionContext,
  PermissionDecision,
} from "./permission.types";
import {
  decideCan,
  decideStrongestScope,
  isGrantActive,
  type ScopeRequest,
} from "./permission.decide";
import { PermissionCatalogSnapshot } from "./permission-catalog-snapshot";

/**
 * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — ALLOWLIST cặp quyền NHẠY CẢM được phép PHƠI vào /auth/me `capabilities`
 * dưới dạng GỢI Ý UI (FE render/ẩn entry điều hướng, vd trang Audit-log viewer). getCapabilities() CỐ Ý lọc bỏ
 * MỌI grant sensitive (FE không được suy quyền nhạy cảm từ map gợi ý) ⇒ FE useCan() trên cặp nhạy cảm luôn
 * false. Allowlist này TÁI MỞ có kiểm soát ĐÚNG các cặp view-only ĐỌC — KHÔNG nới enforcement (cổng thật vẫn là
 * can()/PermissionGuard per-resource). Cặp = "action:resourceType" khớp SEED THẬT (mig 0340: view:audit-log
 * is_sensitive=true), KHÔNG theo mã FE. Wildcard *:* KHÔNG nằm trong allowlist ⇒ KHÔNG kế thừa (mirror sensitive
 * gate của can(): wildcard không thoả cặp nhạy cảm). Thêm cặp mới ⇒ thêm dòng ở đây (curated, append-only).
 *
 * S3-FE-REGISTRY-1 (beCapExpose) — APPEND 4 cặp ATT/LEAVE view NHẠY CẢM để FE dựng CỜ HIỂN THỊ nav
 * (att.team-records / att.records / trang leave). Cặp seed THẬT is_sensitive=true (attendance-permissions.const
 * mig 0454: view-own/view-team/view-company·attendance; leave-permissions.const mig 0455: view·leave). KHÔNG
 * thêm view-own:leave / approve:leave (đã non-sensitive ⇒ lộ qua getCapabilities, không thuộc allowlist).
 * Enforcement KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
 *
 * S2-AUTH-CAP-1 — APPEND 3 cặp NHẠY CẢM để FE dựng CỜ HIỂN THỊ: nút export nghỉ phép + viewer audit-log
 * LEAVE/ATT. Cặp seed THẬT is_sensitive=true, grant Company CHỈ hr(0011)+company-admin(0001):
 *   export:leave              — leave-permissions.const:60 / mig 0455
 *   view:leave-audit-log      — leave-permissions.const:85 / mig 0455
 *   view:attendance-audit-log — attendance-permissions.const:84 / mig 0454
 * employee(0008)/manager(0010) KHÔNG có grant ⇒ least-privilege; wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG
 * kế thừa. Enforcement (can()/PermissionGuard per-resource) KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
 */
const SENSITIVE_CAPABILITY_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "view:audit-log",
  // S3-FE-REGISTRY-1 — APPEND-only (giữ view:audit-log ở trên):
  "view-own:attendance",
  "view-team:attendance",
  "view-company:attendance",
  "view:leave",
  // S2-AUTH-CAP-1 — APPEND-only (giữ 5 cặp trên nguyên vẹn):
  "export:leave",
  "view:leave-audit-log",
  "view:attendance-audit-log",
  // S2-AUTH-BE-12 — APPEND-only: admin reset 2FA của user khác (is_sensitive=true, mig 0466). Mở CỜ HIỂN
  // THỊ cho FE (nút reset-2FA trong màn user-admin); enforcement THẬT vẫn là PermissionGuard per-resource
  // (@RequirePermission('reset-2fa','user',{isSensitive:true})) — allowlist KHÔNG nới cổng.
  "reset-2fa:user",
  // S2-AUTH-CAP-2 — APPEND-only: FE gate nút "Quản lý vai trò" (UserDetailPage/UserRolesPage,
  // PermissionGate assign-role:user) + nút "Phân quyền" (RoleDetailPage/RolesPage/RolePermissionsPage,
  // assign:permission). Cặp seed THẬT is_sensitive=true, grant Company CHỈ company-admin — thiếu allowlist
  // ⇒ nút ẨN với CẢ admin dù grant thật tồn tại (phát hiện 2026-07-07). Enforcement KHÔNG đổi.
  "assign-role:user",
  "assign:permission",
  // S2-AUTH-USEROPS-1 — APPEND-only: xóa mềm / khôi phục / admin đặt lại mật khẩu trên /system/users
  // (nút Xóa · tab Đã xóa + Khôi phục · Đặt lại mật khẩu). Cặp seed THẬT is_sensitive=true (mig 0476:
  // restore/reset-password INSERT mới; delete NÂNG từ false→true của mig 0005), grant Company CHỈ
  // company-admin. Thiếu allowlist ⇒ useCanExact false với CẢ admin (bài học CAP-2). Enforcement KHÔNG
  // đổi — PermissionGuard per-resource (@RequirePermission …, {isSensitive:true}) vẫn là cổng thật.
  "delete:user",
  "restore:user",
  "reset-password:user",
  // S3-ATT-EXPORT-1 — APPEND-only: FE gate nút "Xuất CSV" chấm công (AttendanceReportsPage/records,
  // PermissionGate export:attendance). Cặp seed THẬT is_sensitive=true (attendance-permissions.const:55,
  // mig 0454:42), grant Company CHỈ hr(0011)+company-admin(0001) (mig 0454:124-125). Thiếu allowlist ⇒
  // getAllowlistedSensitiveCapabilities KHÔNG surface ⇒ nút Export ẨN với CẢ HR/company-admin dù grant thật
  // tồn tại (bài học CAP-2/USEROPS-1). Enforcement KHÔNG đổi — @RequirePermission('export','attendance')
  // per-resource vẫn là cổng THẬT (data-scope Own/Team/Company áp TRƯỚC kết xuất). Chỉ mở CỜ HIỂN THỊ.
  "export:attendance",
  // S4-TASK-SEED-1 — APPEND-only: 8 cặp NHẠY CẢM TASK (is_sensitive=true, mig 0485 — grant per ma trận
  // SPEC-06 §9: company-admin đủ bộ @Company; manager các cặp project @Team [owner-check per-project ở
  // BE S4-TASK-BE-1]; hr view-report:project + export:task + view:task-audit-log @Company). done_when #5
  // yêu cầu admin thấy ĐỦ 23 cặp TASK qua /auth/me — thiếu allowlist thì 8 cặp này ẨN với CẢ admin (bài
  // học CAP-2/USEROPS-1/EXPORT-1). Grant-bound + DENY-override giữ; wildcard *:* KHÔNG kế thừa.
  // Enforcement KHÔNG đổi — @RequirePermission per-resource vẫn là cổng thật. Chỉ mở CỜ HIỂN THỊ.
  "delete:project",
  "close:project",
  "archive:project",
  "manage-member:project",
  "view-report:project",
  "delete:task",
  "export:task",
  "view:task-audit-log",
  // S4-NOTI-BE-3 — APPEND-only: 6 cặp NHẠY CẢM NOTI config (is_sensitive=true, seed mig 0481, catalog
  // pin ở notification-event-catalog.const.ts NOTI_CONFIG_PAIRS), grant Company CHỈ company-admin. Thiếu
  // allowlist ⇒ 6 cặp này ẨN với CẢ admin trên /auth/me — CAP-2 đã tái diễn (CAP-2/USEROPS-1/EXPORT-1),
  // done_when WO này bắt buộc phải thấy đủ 6 cặp qua /auth/me. Enforcement KHÔNG đổi — @RequirePermission
  // per-resource (notification-admin.controller.ts) vẫn là cổng thật. Chỉ mở CỜ HIỂN THỊ.
  "view:notification-config",
  "update:notification-config",
  "view:notification-template",
  "update:notification-template",
  "view:notification-delivery-log",
  "view:notification-audit-log",
  // HR-PROFILE-UI-1 — APPEND-only: 2 cặp NHẠY CẢM HR (is_sensitive=true, seed mig 0019/0442-band).
  // FE Hồ sơ nhân sự dùng useCan làm CỜ HIỂN THỊ: cột PII (giới tính/ngày sinh/ĐT/loại HĐ) trong catalog
  // Tùy chỉnh cột + nhãn "bị ẩn do phân quyền" vs "—" ở detail/panel. Thiếu allowlist ⇒ cột PII ẨN với
  // CẢ HR/company-admin dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1 tái diễn). Enforcement
  // KHÔNG đổi — masking THẬT vẫn ở HrReadService per-row (canViewSensitive/revealSalary, isSensitive:true,
  // wildcard không mở; salary reveal ⟹ audit atomic). Chỉ mở CỜ HIỂN THỊ.
  "view-sensitive:employee",
  "view-salary:employee",
  // HR-PROFILE-UI-2 — APPEND-only: FE gate nút "Xuất CSV" màn Hồ sơ nhân sự (EmployeeListPage,
  // useCanExact export:employee). Cặp seed THẬT is_sensitive=true (mig 0491 flip false→true), grant
  // Company CHỈ hr + company-admin. Thiếu allowlist ⇒ getAllowlistedSensitiveCapabilities KHÔNG surface ⇒
  // nút Export ẨN với CẢ HR/company-admin dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1).
  // Enforcement KHÔNG đổi — @RequirePermission('export','employee',{isSensitive:true}) per-resource +
  // data-scope Own/Team/Company áp TRƯỚC kết xuất + row cap 422 vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
  "export:employee",
  // S4-FE-DASH-3 — APPEND-only: 2 cặp NHẠY CẢM DASH config để FE dựng CỜ HIỂN THỊ màn
  // DashboardConfigPage (PermissionGate → useCanExact('view'/'update','dashboard-config')). Cặp seed THẬT
  // is_sensitive=true — catalog dashboard-widget-catalog.const.ts:314-324 (DASH.CONFIG.VIEW /
  // DASH.CONFIG.UPDATE), seed + grant mig 0484 khối (3); grant Company CHỈ company-admin —
  // DASH_GRANT_MATRIX:379-385 (employee/manager/hr KHÔNG có grant, least-privilege). Thiếu allowlist ⇒
  // getCapabilities() lọc bỏ sensitive + getAllowlistedSensitiveCapabilities KHÔNG surface ⇒ 2 cặp ẨN
  // với CẢ company-admin dù grant thật tồn tại ⇒ /auth/me KHÔNG BAO GIỜ trả → useCanExact luôn false ⇒
  // trang LUÔN EmptyState "không có quyền" trong app thật (bài học CAP-2/EXPORT-1/NOTI-BE-3, đã lặp 5+
  // lần). Enforcement KHÔNG đổi — @RequirePermission('view'/'update','dashboard-config',{isSensitive:true})
  // + PermissionGuard class-level (dashboard-config.controller.ts) + RLS company_id vẫn là cổng THẬT;
  // wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG kế thừa. Chỉ mở CỜ HIỂN THỊ.
  "view:dashboard-config",
  "update:dashboard-config",
  // HR-IDENTITY-READ-1 — APPEND-only: cặp NHẠY CẢM CCCD (is_sensitive=true, seed mig 0494), grant Company
  // CHỈ hr + company-admin, Own CHỈ employee (chính chủ). FE Hồ sơ nhân sự dùng useCanExact('view-identity',
  // 'employee') làm CỜ HIỂN THỊ section "Giấy tờ (CMND/CCCD)". Thiếu allowlist ⇒
  // getAllowlistedSensitiveCapabilities KHÔNG surface ⇒ /auth/me KHÔNG trả ⇒ section ẨN với CẢ hr/
  // company-admin/employee dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1). manager KHÔNG có
  // grant ⇒ KHÔNG thấy (least-privilege). Enforcement KHÔNG đổi — HrReadService.revealIdentity per-row
  // (isSensitive:true, wildcard *:* KHÔNG mở, reveal ⟹ audit atomic) vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
  "view-identity:employee",
  // S5-HR-IMPORT-FE-1 — APPEND-only: cặp NHẠY CẢM 'import:employee' (is_sensitive=true, seed mig 0496 —
  // BE lane S5-HR-IMPORT-BE-1 CHỐT DEFER việc allowlist này sang FE lane, ledger 2026-07-13). Grant Company
  // CHỈ hr + company-admin (mig 0496 khối (b); backfill dọn stray blanket-grant role hr-manager media-era
  // từ 0019). FE /hr/employees/import dùng useCanExact('import','employee') làm cổng route + nút "Import
  // nhân viên" (EmployeeListPage). Thiếu allowlist ⇒ /auth/me KHÔNG BAO GIỜ trả cặp này ⇒ route/nút ẨN
  // với CẢ hr/company-admin dù grant thật tồn tại (bài học CAP-2/USEROPS-1/EXPORT-1/DASH-3 tái diễn).
  // Enforcement KHÔNG đổi — @RequirePermission('import','employee',{isSensitive:true})
  // (hr-import.controller.ts) + assertImportScope (Company/System only, hr-employee-import.service.ts)
  // vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
  "import:employee",
  // S6-LEAVE-CAPALLOW-1 — APPEND-only: 10 cặp NHẠY CẢM gác 4 màn QUẢN TRỊ của LEAVE (is_sensitive=true,
  // seed mig 0455), grant Company CHỈ hr + company-admin (employee/manager KHÔNG có ⇒ least-privilege).
  // Thiếu allowlist ⇒ getCapabilities() lọc bỏ sensitive + getAllowlistedSensitiveCapabilities KHÔNG
  // surface ⇒ /auth/me KHÔNG BAO GIỜ trả ⇒ với hr/company-admin:
  //   · LEAVE-SCREEN-011 Chính sách nghỉ — `view:leave-policy` là gate ROUTE ⇒ màn KHÔNG VÀO ĐƯỢC, cũng
  //     KHÔNG hiện trong sidebar. Đây là màn DUY NHẤT bật `accrual_method`, tức đường duy nhất khởi động
  //     engine cộng dồn phép ⇒ lỗi này CHẶN GO-LIVE: `ANNUAL` có deduct_balance=true mà số dư 0 thì mọi
  //     đơn phép năm trả 422 BALANCE_NOT_ENOUGH (phát hiện 2026-08-02 khi chạy cổng go-live).
  //   · LEAVE-SCREEN-010 Loại nghỉ — đọc được (`view:leave-type` KHÔNG sensitive) nhưng 3 nút ghi ẨN.
  //   · LEAVE-SCREEN-012 Số dư phép + màn Giao dịch số dư — ẨN cả route lẫn nút Điều chỉnh.
  // Trước đó CHỈ `SA` dùng được, và chỉ nhờ TAI NẠN: SA có grant `*:*` (is_sensitive=false) nên lọt qua
  // fallback wildcard của useCan() — KHÔNG phải vì allowlist đúng. useCanExact() thì SA cũng trượt.
  // Đây là lần lặp thứ 8+ của CAP-2/USEROPS-1/EXPORT-1/NOTI-BE-3/DASH-3/IDENTITY-READ-1/IMPORT-FE-1 ⇒
  // kèm test khoá `sensitive-screen-gate-allowlist.spec.ts` để lần sau CI đỏ thay vì im lặng.
  // Enforcement KHÔNG đổi — @RequirePermission per-resource (leave.controller.ts) + data-scope + RLS
  // company_id vẫn là cổng THẬT; wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG kế thừa. Chỉ mở CỜ HIỂN THỊ.
  "view:leave-policy",
  "create:leave-policy",
  "update:leave-policy",
  "delete:leave-policy",
  "create:leave-type",
  "update:leave-type",
  "delete:leave-type",
  "view:leave-balance",
  "adjust:leave-balance",
  "view-transaction:leave-balance",
  // S7-CHAT-DB-1 (mig 0538) — APPEND-only. CHAT-DEC-004: đọc-vượt membership, is_sensitive=true
  // ⇒ getCapabilities() LỌC khỏi /auth/me trừ khi có ở đây ⇒ CHAT-SCREEN-007/008 ẨN dù DB có
  // quyền (KI-058, lớp lỗi đã lặp 8+ lần). Thêm NGAY dù màn chưa dựng: đây chỉ là cờ HIỂN THỊ,
  // enforcement vẫn là PermissionGuard per-resource. FE gate bằng useCanExact (useCan rơi *:*).
  "view:chat-oversight",
  // S10-QA-SECPOLICY-GATE-1 (KI-065, nửa thứ hai) — APPEND-only. `configure-security-policy:company`
  // là is_sensitive=true (đo trên DB: catalog `permissions` cờ `t`), grant Company CHỈ company-admin
  // (đo: `roles ⋈ role_permissions ⋈ permissions` chỉ trả đúng một hàng company-admin/ALLOW). Không có
  // hàng wildcard `*:*` nào trong catalog ⇒ ngay cả fallback của `useCan` cũng không cứu được. Thiếu
  // allowlist ⇒ `/auth/me` KHÔNG BAO GIỜ trả cặp này ⇒ `console/routes/settings/security-policy.tsx`
  // LUÔN render EmptyState "không có quyền" với CHÍNH company-admin — tức sau khi vá route chết ở BE
  // (KI-065) tính năng VẪN không dùng được từ UI. Đây là lần lặp thứ 9+ của
  // CAP-2/USEROPS-1/EXPORT-1/NOTI-BE-3/DASH-3/IDENTITY-READ-1/IMPORT-FE-1/LEAVE-CAPALLOW-1.
  // Enforcement KHÔNG đổi — @RequirePermission('configure-security-policy','company',{isSensitive:true})
  // + PermissionGuard + RLS company_id vẫn là cổng THẬT; wildcard KHÔNG thuộc allowlist ⇒ KHÔNG kế thừa.
  // Chỉ mở CỜ HIỂN THỊ.
  "configure-security-policy:company",
  // S12-RECRUIT-BE-1 — APPEND-only: 7 cặp `candidate` is_sensitive=true (seed mig 0560, SPEC-12 §11)
  // gác các màn REC-SCREEN-002..006 (danh sách/chi tiết ứng viên · kanban · export · convert). Thiếu
  // allowlist ⇒ /auth/me KHÔNG trả ⇒ màn ẨN với CHÍNH role recruiter/hr được cấp quyền (lần lặp 10+
  // của CAP-2). Enforcement KHÔNG đổi — @RequirePermission + tầng 2 RecruitAccessService (isSensitive
  // tường minh) + RLS vẫn là cổng THẬT; wildcard *:* KHÔNG thuộc allowlist. Chỉ mở CỜ HIỂN THỊ.
  "view:candidate",
  "create:candidate",
  "update:candidate",
  "move-stage:candidate",
  "comment:candidate",
  "export:candidate",
  "convert:candidate",
  // S13-PAYROLL-BE-1 — APPEND-only: 13 cặp PAYROLL is_sensitive=true (seed mig 0565, SPEC-11 §11.1)
  // gác toàn bộ màn hình tiền lương. Khai NGAY ở WO BE dù màn FE dựng ở S13-PAYROLL-FE-1: thiếu
  // allowlist ⇒ getCapabilities() lọc bỏ sensitive ⇒ /auth/me KHÔNG BAO GIỜ trả ⇒ màn ẨN với CHÍNH
  // payroll-officer/company-admin được cấp quyền (lần lặp 11+ của CAP-2 → … → RECRUIT-BE-1).
  // Enforcement KHÔNG đổi — @RequirePermission (isSensitive tường minh) + tầng 2 PayrollAccessService
  // + sàn scope Company + RLS company_id vẫn là cổng THẬT; wildcard *:* KHÔNG thuộc allowlist ⇒ KHÔNG
  // kế thừa. Chỉ mở CỜ HIỂN THỊ.
  // 4 cặp KHÔNG sensitive của PAYROLL (`access:payroll` · `view:payroll-period` ·
  // `manage:payroll-period` · `acknowledge-own-payslip:payslip`) KHÔNG cần ở đây — chúng đã surface.
  "calculate:payroll-period",
  "view-line:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "export:payroll",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
  // S14-RECRUIT-FILEGRANT-1 — APPEND-only: cặp GHI tệp CV `('upload','candidate-file')`
  // is_sensitive=TRUE (seed mig 0569, SPEC-12 §11). FE gate nút "Tải CV lên" bằng
  // `useCanExact('upload','candidate-file')`. Thiếu allowlist ⇒ getCapabilities() lọc bỏ sensitive ⇒
  // /auth/me KHÔNG BAO GIỜ trả ⇒ nút ẨN với CHÍNH recruiter/hr vừa được cấp quyền (lần lặp 12+ của
  // CAP-2 → … → PAYROLL-BE-1). Enforcement KHÔNG đổi — decorator @RequirePermission + tầng 2
  // RecruitAccessService (isSensitive lấy từ RECRUIT_ROUTE_PAIRS) + sàn scope Company + 5 vế
  // `RecruitCandidateFileResolver.canLinkFile` vẫn là cổng THẬT; wildcard KHÔNG kế thừa.
  "upload:candidate-file",
]);

/**
 * Cặp NHẠY CẢM đang được dùng làm **cổng MÀN HÌNH** ở FE (route gate hoặc nút hành động chính).
 *
 * Vì sao tồn tại: `getCapabilities()` lọc bỏ TOÀN BỘ cặp `is_sensitive`, nên một cặp gác màn mà quên
 * thêm vào `SENSITIVE_CAPABILITY_ALLOWLIST` sẽ làm màn đó **biến mất** với đúng những vai được cấp
 * quyền — im lặng, không lỗi, không log. Lớp lỗi này đã lặp **8+ lần** trong repo (CAP-2 → USEROPS-1 →
 * EXPORT-1 → NOTI-BE-3 → DASH-3 → IDENTITY-READ-1 → IMPORT-FE-1 → LEAVE-CAPALLOW-1) và lần gần nhất
 * chặn go-live vì màn bật engine cộng dồn phép không vào được.
 *
 * **Thêm màn quản trị mới gác bằng cặp `is_sensitive` ⇒ thêm cặp đó vào ĐÂY.** Test
 * `sensitive-screen-gate-allowlist.spec.ts` ép nó phải nằm trong allowlist, nên quên sẽ ĐỎ CI thay vì
 * ẩn màn trong im lặng.
 */
export const SENSITIVE_SCREEN_GATE_PAIRS: readonly string[] = [
  // LEAVE-SCREEN-010 Loại nghỉ (view:leave-type KHÔNG sensitive nên không liệt kê ở đây)
  "create:leave-type",
  "update:leave-type",
  "delete:leave-type",
  // LEAVE-SCREEN-011 Chính sách nghỉ — view là gate ROUTE
  "view:leave-policy",
  "create:leave-policy",
  "update:leave-policy",
  "delete:leave-policy",
  // LEAVE-SCREEN-012 Số dư phép + Giao dịch số dư — view/view-transaction là gate ROUTE
  "view:leave-balance",
  "adjust:leave-balance",
  "view-transaction:leave-balance",
  // DASH — DashboardConfigPage (S4-FE-DASH-3)
  "view:dashboard-config",
  "update:dashboard-config",
  // HR — /hr/employees/import (S5-HR-IMPORT-FE-1)
  "import:employee",
  // CHAT — CHAT-SCREEN-007 (quản trị đọc-vượt) + 008 (nhật ký), S7-CHAT-FE-5
  "view:chat-oversight",
  // CS-9 — console `/settings/security-policy` (S10-QA-SECPOLICY-GATE-1): cặp này gác CẢ MÀN
  // (không có quyền ⇒ EmptyState), nên nó phải surface được qua /auth/me.
  "configure-security-policy:company",
  // RECRUIT — 7 cặp `candidate` is_sensitive=true (mig 0560, SPEC-12 §11) gác các màn REC-SCREEN-002..006
  // (S12-RECRUIT-BE-1 — FE cần cờ hiển thị qua /auth/me capabilities; wildcard *:* không kế thừa).
  "view:candidate",
  "create:candidate",
  "update:candidate",
  "move-stage:candidate",
  "comment:candidate",
  "export:candidate",
  "convert:candidate",
  // PAYROLL — 13 cặp is_sensitive=true (mig 0565, SPEC-11 §11.1) gác các màn PAYROLL-SCREEN-*
  // (S13-PAYROLL-BE-1; FE cần cờ hiển thị qua /auth/me capabilities — wildcard *:* không kế thừa).
  "calculate:payroll-period",
  "view-line:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "export:payroll",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
  // RECRUIT — cặp GHI tệp CV gác nút "Tải CV lên" của REC-SCREEN-003 (tab CV), S14-RECRUIT-FILEGRANT-1.
  "upload:candidate-file",
];

/** Chỉ dùng cho test khoá — KHÔNG export ra ngoài module permission. */
export const __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST = SENSITIVE_CAPABILITY_ALLOWLIST;

/**
 * Trải chuỗi `Error.cause` thành object log được.
 *
 * Vì sao cần: Drizzle bọc lỗi PG và GIẤU mã lỗi (SQLSTATE) trong `cause`
 * (memory `drizzle-wraps-pg-error-code-in-cause`). Log mỗi `error.message` là vứt đúng thứ duy nhất
 * phân biệt được 42501 với cạn connection pool.
 *
 * Có TRẦN ĐỘ SÂU: chuỗi `cause` có thể tự tham chiếu vòng; không có trần thì hàm quan sát này tự
 * đệ quy vô hạn — tức một hàm sinh ra để chẩn đoán sự cố lại thành sự cố.
 */
function serializeErrorChain(error: unknown, depth = 0): unknown {
  if (depth >= 4) return "[cause chain truncated]";
  if (!(error instanceof Error)) return error === undefined ? undefined : String(error);
  return {
    name: error.name,
    message: error.message,
    code: (error as { code?: unknown }).code,
    cause: error.cause === undefined ? undefined : serializeErrorChain(error.cause, depth + 1),
  };
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  /**
   * S14-SEC-DASHGATE-WILDCARD-1 (ADR `DECISIONS-12`) — ảnh chụp cờ `is_sensitive` theo CẶP ĐÍCH.
   *
   * Dựng TẠI ĐÂY chứ không phải provider DI mới, có chủ đích: `new PermissionService(` xuất hiện ~56
   * chỗ trong `apps/api` (phần lớn là int-spec dựng tay). Thêm tham số constructor = typecheck đỏ hàng
   * chục file; thêm tham số OPTIONAL = bản vá INERT ở đúng những int-spec chống-leo-thang, tức test
   * chống lỗ lại chạy trên engine chưa vá (memory `tests-can-pin-a-hole-open`). Tự dựng từ `this.repo`
   * ⇒ 0 call-site đổi, 0 provider mới, 0 dòng `permission.module.ts`.
   *
   * State PER-INSTANCE (không module-level): các spec dựng nhiều `PermissionService` với stub catalog
   * khác nhau trong CÙNG file phải không giẫm lên nhau.
   */
  private readonly catalog = new PermissionCatalogSnapshot({
    load: () => this.repo.getAllPermissions(),
    onError: (error, phase, cause) => {
      // Luật quan sát: nhánh suy biến phải ĐỂ LẠI VẾT. `no-snapshot` là nhánh SIẾT (mọi cặp coi như
      // sensitive) — im lặng ở đây là để hệ thống từ chối quyền vì lý do hạ tầng mà không ai biết.
      //
      // Message phân nhánh theo NGUYÊN NHÂN: nhánh rỗng là một lượt nạp THÀNH CÔNG, gọi nó là "load
      // failed" là ghi một dòng sai sự thật vào đúng chỗ quan sát duy nhất của nhánh đó.
      //
      // ⚠️ Chuỗi nhánh THROW giữ NGUYÊN TỪNG KÝ TỰ — `permission.decide.pair-sensitive.spec.ts` tìm
      // dòng log bằng `includes("catalog snapshot load failed")`. Đừng «đồng bộ hoá» hai message.
      this.logger.error(
        cause === "empty-catalog"
          ? "permission catalog snapshot is EMPTY (0 rows) — degenerate"
          : "permission catalog snapshot load failed",
        {
          // ⚠️ KHÔNG rút gọn về `error.message`. Drizzle GIẤU mã lỗi PG (SQLSTATE) trong `cause`
          // (memory `drizzle-wraps-pg-error-code-in-cause`) ⇒ `.message` trần chỉ còn
          // "Failed query: select id, action, resource_type, is_sensitive from permissions", không
          // phân biệt được 42501 (insufficient_privilege) với cạn pool hay lỗi driver. Đây là chẩn
          // đoán DUY NHẤT của nhánh fail-closed: mọi `can()` trong tiến trình đang trả
          // `pairIsSensitive=true`, tức một cơn bão từ-chối-quyền. Người trực phải đọc ra được vì sao.
          error: serializeErrorChain(error),
          // Nest chỉ nhận stack khi nó là CHUỖI khớp `isStackFormat`; một object không bao giờ được
          // coi là stack ⇒ phải đưa stack sang trường riêng, dạng chuỗi.
          stack: error instanceof Error ? error.stack : undefined,
          phase,
          cause,
          // SUY RA từ `phase` — nguồn DUY NHẤT của KẾT QUẢ. Không hard-code theo `cause`: một sự cố
          // rỗng vẫn có thể là `stale-kept` (giữ ảnh cũ), không phải lúc nào cũng siết.
          degradedTo: phase === "no-snapshot" ? "pairIsSensitive=true (siết)" : "ảnh chụp CŨ",
        },
      );
    },
  });

  constructor(private readonly repo: IPermissionRepository) {}

  /**
   * ADR `DECISIONS-12` D7 — seam TEST duy nhất cho ảnh chụp catalog. int-spec gọi qua
   * `app.get(PermissionService)` SAU khi seed cặp quyền mới, nếu không ảnh chụp nạp lúc kiểm quyền đầu
   * tiên sẽ không thấy hàng vừa seed (TTL 5 phút).
   *
   * KHÔNG export hàm module-level thay cho method này: hàm module-level không chạm được ảnh chụp của
   * instance singleton mà DI đang dùng ⇒ dây chết trông như dây sống.
   */
  resetCatalogSnapshotForTest(): void {
    this.catalog.reset();
  }

  /**
   * Cờ `is_sensitive` của CẶP ĐÍCH. NEVER throws (xem `PermissionCatalogSnapshot`) — `can()` bọc
   * try/catch fail-closed, nên một lỗi catalog ném ra sẽ deny TOÀN BỘ kiểm quyền của tiến trình.
   */
  private pairIsSensitiveFor(action: string, resourceType: string): Promise<boolean> {
    return this.catalog.isPairSensitive(action, resourceType);
  }

  /**
   * 4-tier permission check (§3b of G3-permission-engine.md).
   *
   * Priority (lower number = higher authority):
   *   1. Object-level DENY  → deny-explicit (immediate)
   *   2. Object-level ALLOW → allow (beats company-level; object grants are always exact — no wildcards)
   *   3. Company-level DENY (any role DENY across all roles) → deny-explicit
   *   4. Company-level ALLOW → allow (wildcards valid for non-sensitive only)
   *   5. Default            → deny-default
   *
   * Sensitive gate: wildcard grants (*:*) do NOT satisfy; requires exact non-wildcard ALLOW.
   * Defense-in-depth: effectivelySensitive = input.isSensitive OR any matching grant.isSensitive.
   *
   * expires_at: re-checked per call (cache-hit safety — not delegated to repository).
   * fail-closed: any DB/infrastructure error → DENY, logged, never false-ALLOW.
   */
  async can(input: CanInput): Promise<PermissionDecision> {
    // NOTE: requiresReauth / objectGrantRequired are consumed inside decideCan(input) — we destructure
    // only what the fetch + fail-closed log need here (keeps the decision logic in one place).
    const { userId, companyId, action, resourceType, resourceId, isSensitive = false, ctx } = input;

    try {
      const now = new Date();

      // ── Company-level grants ──────────────────────────────────────────────
      // Repository may include stale/expired rows (cache scenario). decideCan re-checks expiresAt.
      const rawCompanyGrants = await this.repo.getCompanyRoleGrants(userId, companyId);

      // ── Object-level grants ───────────────────────────────────────────────
      // Only queried when a specific resource instance is identified.
      // null/undefined resourceId = type-level check (Tầng 1+4 only, Tầng 3 skipped).
      const objectGrants =
        resourceId != null
          ? await this.repo.getObjectGrants(userId, companyId, resourceType, resourceId)
          : [];

      // ── Cờ catalog của CẶP ĐÍCH (S14-SEC-DASHGATE-WILDCARD-1) ─────────────
      // Bơm Ở ĐÂY chứ không ở 25 call-site thiếu cờ: phần lớn site truyền cặp ĐỘNG nên chúng cũng sẽ
      // phải tra catalog — tức cùng một việc, nhân 25, cộng 25 cơ hội quên (ADR `DECISIONS-12` §3).
      const pairIsSensitive = await this.pairIsSensitiveFor(action, resourceType);

      // ── Decide ────────────────────────────────────────────────────────────
      // Single source of truth (permission.decide.ts) — SHARED verbatim with canBatch(); the two paths
      // differ ONLY in the fetch above (single vs batched), never in the decision semantics.
      return decideCan(rawCompanyGrants, objectGrants, { ...input, pairIsSensitive }, now);
    } catch (error: unknown) {
      // Fail-closed: DB/cache/network error → DENY. Never false-ALLOW on exception.
      // Log with full context so infra failures are distinguishable from legitimate denies.
      this.logger.error("permission.can() infrastructure error — fail-closed deny", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
        resourceId,
        requestId: ctx?.requestId,
      });
      return { allow: false, reason: "deny-default", auditRequired: isSensitive };
    }
  }

  /**
   * HR-PERF-1 (beBatchPermHr) — BATCHED 4-tier check for a PAGE of resource instances (same user,
   * company, resourceType). For a list surface (e.g. HR employees) this replaces the per-row 2N can()
   * loop with a fixed ≤2 repository reads: getCompanyRoleGrants ONCE + getObjectGrantsBatch ONCE.
   *
   * Each (resourceId × action) decision is computed by the SAME decideCan() as can() — so a batched
   * decision is BYTE-IDENTICAL to the per-row can() (object-DENY priority-1, sensitive wildcard-fail,
   * company-DENY override, fail-closed all preserved). Returns a Map<resourceId, Map<action, decision>>
   * with an entry for EVERY (resourceId × action).
   *
   * Fail-closed: ANY repository error → EVERY cell is a deny-default (allow:false), mirror of can()'s
   * catch (auditRequired = the action's isSensitive). Never false-ALLOW on infrastructure failure.
   */
  async canBatch(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceIds: string[],
    actions: BatchActionSpec[],
    ctx?: PermissionContext,
  ): Promise<BatchDecisions> {
    try {
      if (resourceIds.length === 0) return new Map();
      const now = new Date();

      // ≤2 repository reads for the whole page (vs 2N with per-row can()).
      const rawCompanyGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const objectBatch = await this.repo.getObjectGrantsBatch(
        userId,
        companyId,
        resourceType,
        resourceIds,
      );

      // Cờ catalog theo CẶP — MỘT lần cho mỗi action, KHÔNG lặp theo resourceId (một trang N hàng ×
      // M action vẫn chỉ hỏi M lần, và single-flight gộp chúng thành ≤1 query).
      //
      // MẢNG theo CHỈ SỐ, cố ý KHÔNG phải `Map<action, boolean>`: `Map.get()` trả `undefined` khi
      // miss, và `?? false` sau đó là fail-OPEN — cặp sensitive bị coi là thường ⇒ wildcard thoả gate.
      // Cùng lý do `resolveStrongestScopes` trả mảng chứ không trả Map (xem doc-block của nó). Hôm nay
      // không miss được, nhưng một refactor thêm `continue` vào vòng dựng là đủ để mở lỗ trong im lặng.
      const pairFlags = await Promise.all(
        actions.map((spec) => this.pairIsSensitiveFor(spec.action, resourceType)),
      );

      const result: BatchDecisions = new Map();
      for (const resourceId of resourceIds) {
        const objectGrants = objectBatch.get(resourceId) ?? [];
        const perAction = new Map<string, PermissionDecision>();
        for (const [specIndex, spec] of actions.entries()) {
          const input: CanInput = {
            userId,
            companyId,
            action: spec.action,
            resourceType,
            resourceId,
            isSensitive: spec.isSensitive,
            pairIsSensitive: pairFlags[specIndex],
            requiresReauth: spec.requiresReauth,
            objectGrantRequired: spec.objectGrantRequired,
            ctx,
          };
          perAction.set(spec.action, decideCan(rawCompanyGrants, objectGrants, input, now));
        }
        result.set(resourceId, perAction);
      }
      return result;
    } catch (error: unknown) {
      // Fail-closed GLOBALLY: one infra failure denies the WHOLE page — mirror can()'s catch per cell.
      this.logger.error("permission.canBatch() infrastructure error — fail-closed deny (page)", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        resourceType,
        count: resourceIds.length,
        requestId: ctx?.requestId,
      });
      const denied: BatchDecisions = new Map();
      for (const resourceId of resourceIds) {
        const perAction = new Map<string, PermissionDecision>();
        for (const spec of actions) {
          perAction.set(spec.action, {
            allow: false,
            reason: "deny-default",
            auditRequired: spec.isSensitive ?? false,
          });
        }
        denied.set(resourceId, perAction);
      }
      return denied;
    }
  }

  /**
   * AC-5 — danh sách scope (catalog entry) actor được phép gán cho PAT = toàn catalog ∩ grant THỰC actor.
   * Dùng dựng bộ chọn scope FE. Lỗi DB → [] (fail-safe cho UI hint; create vẫn ép lại scope ⊆ grant).
   */
  async listGrantableScopes(
    userId: string,
    companyId: string,
  ): Promise<Array<{ id: string; action: string; resourceType: string; isSensitive: boolean }>> {
    try {
      const catalog = await this.repo.getAllPermissions();
      if (catalog.length === 0) return [];
      const grantedIds = await this.userGrantsPermissionIds(
        userId,
        companyId,
        catalog.map((p) => p.id),
      );
      const grantedSet = new Set(grantedIds);
      return catalog.filter((p) => grantedSet.has(p.id));
    } catch (error: unknown) {
      this.logger.error("listGrantableScopes() infrastructure error — returning empty", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return [];
    }
  }

  /**
   * Returns a flat map of non-sensitive capabilities for the given user.
   * Key format: "${action}:${resourceType}" — wildcards included as-is (FE handles multi-key lookup).
   * Only non-sensitive grants; sensitive permissions require explicit per-resource checks.
   * Deny-overrides-across-roles applied: any DENY removes the key entirely.
   * On error → empty map (fail-safe for UI hints, never fail-closed like can()).
   */
  async getCapabilities(userId: string, companyId: string): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }

      // Wildcard-aware deny check: a DENY on *:T or A:* or *:* suppresses matching ALLOW keys.
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of grants) {
        if (g.effect === "ALLOW" && !isDenied(g.action, g.resourceType)) {
          caps[`${g.action}:${g.resourceType}`] = true;
        }
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error("getCapabilities() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * FIX-1-CAP-EXPOSE (S2-AUTH-BE-5) — map cờ cho các cặp NHẠY CẢM trong SENSITIVE_CAPABILITY_ALLOWLIST mà user
   * THỰC SỰ được ALLOW ở cấp-role (company-tier). getCapabilities() lọc bỏ TẤT CẢ sensitive ⇒ FE useCan() trên
   * cặp nhạy cảm luôn false (vd viewer audit-log không bao giờ render được). Method này surface CÓ KIỂM SOÁT ĐÚNG
   * cặp allowlist để FE render entry/nav. KHÔNG đổi semantics getCapabilities() (caller module-catalog giữ
   * nguyên) và KHÔNG phải cổng enforcement — can()/PermissionGuard per-resource vẫn là cổng THẬT.
   *
   * Thuật toán = Y HỆT getCapabilities (đọc getCompanyRoleGrants, isGrantActive, deny-override wildcard-aware) +
   * 2 ràng buộc:
   *   - chỉ thêm key khi cặp LITERAL "action:resourceType" ∈ allowlist ⇒ wildcard (*:* / view:*) KHÔNG khớp
   *     allowlist ⇒ KHÔNG kế thừa (mirror sensitive gate can(): wildcard không thoả cặp nhạy cảm).
   *   - deny-override tính trên TẤT CẢ active grants (DENY trên cặp nhạy cảm HOẶC wildcard *:* đều suppress) —
   *     an toàn hơn getCapabilities (vốn chỉ tính deny trên tập non-sensitive).
   * Lỗi hạ tầng → {} (fail-safe UI hint — KHÔNG fail-closed như can()).
   */
  async getAllowlistedSensitiveCapabilities(
    userId: string,
    companyId: string,
  ): Promise<Record<string, boolean>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const active = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const denyKeys = new Set<string>();
      for (const g of active) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const caps: Record<string, boolean> = {};
      for (const g of active) {
        if (g.effect !== "ALLOW") continue;
        const key = `${g.action}:${g.resourceType}`;
        // Allowlist gate: chỉ cặp LITERAL nhạy cảm được phép (wildcard không có trong allowlist ⇒ loại bỏ ⇒
        // sensitive KHÔNG kế thừa qua *:*). Sau đó áp deny-override wildcard-aware (mirror getCapabilities).
        if (!SENSITIVE_CAPABILITY_ALLOWLIST.has(key)) continue;
        if (isDenied(g.action, g.resourceType)) continue;
        caps[key] = true;
      }
      return caps;
    } catch (error: unknown) {
      this.logger.error(
        "getAllowlistedSensitiveCapabilities() infrastructure error — returning empty map",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
      return {};
    }
  }

  /**
   * S2-AUTH-BE-1 — union data_scope cho từng cặp ALLOW non-sensitive (cho /auth/me `scopes`, BACKEND-03 §15.3
   * rule 6). KEYSET Y HỆT getCapabilities: chỉ ALLOW non-sensitive; cặp bị DENY-override (wildcard-aware) bị
   * LOẠI hoàn toàn (KHÔNG union). Mảng scope đã DEDUPE. Lỗi hạ tầng → {} (fail-safe UI hint; guard BE-2 là cổng
   * thật). Độc lập getCapabilities: nếu method này lỗi mà getCapabilities ok, /me trả caps không kèm scope —
   * chấp nhận (chỉ là gợi ý FE).
   */
  async getCapabilityScopes(
    userId: string,
    companyId: string,
  ): Promise<Record<string, DataScope[]>> {
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now) && !g.isSensitive);

      const denyKeys = new Set<string>();
      for (const g of grants) {
        if (g.effect === "DENY") denyKeys.add(`${g.action}:${g.resourceType}`);
      }
      const isDenied = (action: string, resourceType: string): boolean =>
        denyKeys.has(`${action}:${resourceType}`) ||
        denyKeys.has(`*:${resourceType}`) ||
        denyKeys.has(`${action}:*`) ||
        denyKeys.has("*:*");

      const scopeSets = new Map<string, Set<DataScope>>();
      for (const g of grants) {
        if (g.effect !== "ALLOW" || isDenied(g.action, g.resourceType)) continue;
        const key = `${g.action}:${g.resourceType}`;
        const set = scopeSets.get(key) ?? new Set<DataScope>();
        set.add(g.dataScope as DataScope);
        scopeSets.set(key, set);
      }

      const out: Record<string, DataScope[]> = {};
      for (const [key, set] of scopeSets) out[key] = [...set];
      return out;
    } catch (error: unknown) {
      this.logger.error("getCapabilityScopes() infrastructure error — returning empty map", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
      });
      return {};
    }
  }

  /**
   * S2-AUTH-BE-2 — effective (strongest) data_scope cho 1 cặp (action,resourceType) ĐÃ được phép.
   * Đây là phần "scope" của cổng cuối: consumer (HR list/detail) dùng để dịch sang điều kiện query.
   *
   * Thuật toán (PIN chống nới scope ngầm — BACKEND-03 §18, plan-review):
   *   1. DENY-overrides (wildcard-aware) khớp → null (chặn, ưu tiên cao nhất).
   *   2. Mỗi grant đóng góp ĐÚNG dataScope của chính nó — KHÔNG nâng cấp (vd: *:* mang 'Company' KHÔNG thành System).
   *   3. Sensitive (caller-hint HOẶC grant.isSensitive) → chỉ EXACT non-wildcard ALLOW đủ điều kiện (mirror can()).
   *   4. EXACT > WILDCARD: có exact ALLOW đủ điều kiện → mạnh nhất trong exact; else (non-sensitive) → mạnh nhất wildcard.
   *   5. Không đủ điều kiện → null. Lỗi hạ tầng → fail-closed null (KHÁC getCapabilityScopes fail-safe {} cho UI).
   * KHÔNG đụng can() hot-path; method độc lập, read-only.
   */
  async resolveStrongestScope(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope | null> {
    try {
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      const pairIsSensitive = await this.pairIsSensitiveFor(action, resourceType);
      return decideStrongestScope(
        rawGrants,
        { action, resourceType, isSensitive: opts?.isSensitive, pairIsSensitive },
        new Date(),
      );
    } catch (error: unknown) {
      this.logger.error("resolveStrongestScope() infrastructure error — fail-closed null", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        companyId,
        action,
        resourceType,
      });
      return null;
    }
  }

  /**
   * S14-PERF-DASHACTOR-1 — N cặp, **MỘT** lượt đọc grant. Mirror `canBatch()` cho trục scope:
   * `resolveStrongestScope` và method này khác nhau ĐÚNG ở tầng FETCH (1 vs N câu hỏi trên CÙNG tập
   * grant), tầng DECIDE là chung một hàm `decideStrongestScope` ⇒ hai đường không thể trôi khỏi nhau.
   *
   * ⚠️ **Trả MẢNG THEO CHỈ SỐ, cùng độ dài và thứ tự với `requests` — CỐ Ý không phải `Map`.**
   * `Map.get()` trả `undefined` khi miss, mà người gọi kiểm deny bằng `scope !== null` (khuôn cờ
   * `canSeeCandidatePii`/`canSeeSalary` ở `recruit-access.service.ts`): `undefined !== null` là TRUE
   * ⇒ một map-miss biến DENY thành ALLOW trong im lặng, và typecheck không bắt được. Mảng cũng loại
   * bỏ đụng độ khoá: hai request CÙNG cặp nhưng khác `isSensitive` (vd `update:candidate` hỏi cả ở
   * vai cặp-route lẫn vai cờ-mask-PII) có ô riêng, bản lỏng hơn không thể đè bản sensitive.
   *
   * `requests` rỗng ⇒ trả `[]` **TRƯỚC** khi chạm repository (mirror `canBatch` :383) — người gọi gom
   * theo điều kiện (vd chỉ widget khai sàn) không được trả giá một round-trip cho danh sách rỗng.
   *
   * Lỗi hạ tầng ⇒ fail-closed **TOÀN LƯỢT**: mảng ĐỦ ĐỘ DÀI toàn `null` (mirror canBatch deny cả
   * trang). KHÔNG partial — nửa giá trị thật nửa null là quyết định quyền trên dữ liệu nửa vời.
   */
  async resolveStrongestScopes(
    userId: string,
    companyId: string,
    requests: readonly ScopeRequest[],
  ): Promise<(DataScope | null)[]> {
    if (requests.length === 0) return [];
    try {
      const now = new Date();
      const rawGrants = await this.repo.getCompanyRoleGrantsWithScope(userId, companyId);
      // N cặp ⇒ N lần TRA ảnh chụp, nhưng ≤1 query: single-flight gộp mọi lượt hỏi trên ảnh chụp lạnh
      // (ADR `DECISIONS-12` D6). Short-circuit `requests.length === 0` ở trên vẫn đi TRƯỚC cả hai.
      const pairFlags = await Promise.all(
        requests.map((req) => this.pairIsSensitiveFor(req.action, req.resourceType)),
      );
      return requests.map((req, i) =>
        decideStrongestScope(rawGrants, { ...req, pairIsSensitive: pairFlags[i] }, now),
      );
    } catch (error: unknown) {
      this.logger.error(
        "resolveStrongestScopes() infrastructure error — fail-closed null (batch)",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
          // Bản đơn log kèm action/resourceType; bản batch log MỘT lần ⇒ phải mang ĐỦ danh sách cặp,
          // nếu không mọi deny của lượt này mất dấu vết (luật quan sát).
          pairs: requests.map((r) => `${r.action}:${r.resourceType}`),
        },
      );
      return requests.map(() => null);
    }
  }

  /**
   * AC-5 — filter `permissionIds` xuống tập user THỰC SỰ được phép (effective ALLOW, đã trừ DENY-overrides
   * + bỏ wildcard). Dùng lúc TẠO PAT: scope của key PHẢI ⊆ tập này (PAT KHÔNG vượt quyền user, fail-closed).
   *
   * Cách tính: với mỗi permission id → (action, resourceType, isSensitive) qua catalog; user "có" nếu một
   * company-grant ALLOW khớp (exact với sensitive — wildcard KHÔNG thoả gate nhạy cảm, mirror can()) VÀ
   * KHÔNG bị DENY khớp (deny-overrides). Trả tập con của `permissionIds`. Lỗi DB → [] (fail-closed: không
   * giao id nào → caller từ chối tạo key vượt quyền). KHÔNG xét object-grant (PAT là company-tier capability).
   */
  async userGrantsPermissionIds(
    userId: string,
    companyId: string,
    permissionIds: string[],
  ): Promise<string[]> {
    if (permissionIds.length === 0) return [];
    try {
      const now = new Date();
      const catalog = await this.repo.getPermissionsByIds(permissionIds);
      const rawGrants = await this.repo.getCompanyRoleGrants(userId, companyId);
      const grants = rawGrants.filter((g) => isGrantActive(g.expiresAt, now));

      const matches = (g: CompanyRoleGrant, action: string, resourceType: string): boolean =>
        (g.action === action || g.action === "*") &&
        (g.resourceType === resourceType || g.resourceType === "*");

      return catalog
        .filter((p) => {
          const denied = grants.some(
            (g) => g.effect === "DENY" && matches(g, p.action, p.resourceType),
          );
          if (denied) return false;
          const allows = grants.filter(
            (g) => g.effect === "ALLOW" && matches(g, p.action, p.resourceType),
          );
          if (allows.length === 0) return false;
          // Sensitive gate: wildcard KHÔNG thoả — cần exact non-wildcard ALLOW (mirror can()).
          if (p.isSensitive) {
            return allows.some((g) => g.action !== "*" && g.resourceType !== "*");
          }
          return true;
        })
        .map((p) => p.id);
    } catch (error: unknown) {
      this.logger.error(
        "userGrantsPermissionIds() infrastructure error — fail-closed (empty set)",
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          companyId,
        },
      );
      return [];
    }
  }
}

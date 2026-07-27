/**
 * S6-SEC-ROUTEMAP-1 — SỔ PHÁN QUYẾT ROUTE KHÔNG GATE (nguồn của Phụ lục A, máy-đọc).
 *
 * PHẠM VI BẮT BUỘC: **mọi route KHÔNG có `@RequirePermission`** — tức cả (a) route không gate gì
 * (43) và (b) route `@Public()` (12). Vế (b) là chỗ Phụ lục A cũ hụt: bản 2026-07-26 chỉ phán quyết
 * 2 trong 12 route `@Public` (`/health`, `/health/db`) và bỏ trắng 10 route còn lại — trong đó có
 * `POST /auth/login`, `POST /auth/reset-password`, `POST /users/activation/accept`. `@Public` là mức
 * rủi ro CAO NHẤT (bỏ qua JwtAuthGuard + CompanyGuard + PermissionGuard), nên nó phải được ký, không
 * phải được miễn.
 *
 * LUẬT (giống hệt `MUTATION_BASELINE` mà sổ này thay thế):
 *  1. Mỗi route mang **ĐÚNG MỘT** phán quyết + lý do viết thành câu. Không có ô "để trống".
 *  2. Thêm một dòng vào đây là **QUYẾT ĐỊNH BẢO MẬT**, không phải thao tác dọn test cho xanh.
 *  3. `GAP` = đã biết là lỗ, PHẢI trỏ Work Order/known-issue đang mở. Danh sách `GAP` bị **đóng băng**
 *     bởi test (`FROZEN_GAPS`) ⇒ không ai thêm lỗ mới bằng cách viết thêm một dòng `GAP`.
 *  4. Route biến mất khỏi runtime mà dòng còn ở đây ⇒ test ĐỎ (nợ đã trả thì phải gỡ khỏi sổ).
 *
 * VÌ SAO KHÔNG DÙNG REGEX/GREP ĐỂ DỰNG SỔ NÀY: xem đầu `route-census.ts` (§0.4 — parse tĩnh sai 4 lần).
 * Khoá là `Controller#method` runtime, verify bằng chính census đã boot.
 */

/** Bảy ô phán quyết của Phụ lục A. Không có ô thứ tám — nếu cần, đó là một quyết định của owner. */
export type Verdict =
  /** Chủ thể bị ép từ token trong service (`req.user.id`) ⇒ chỉ chạm dữ liệu của CHÍNH người gọi. */
  | "SELF"
  /** `@Public()` — cố ý bỏ mọi guard; phải tự nêu cái gì thay thế chứng thực (token/cookie/pre-auth). */
  | "PUBLIC"
  /** Có guard KHÁC `PermissionGuard` gác (InternalGuard, LmsServiceIntakeGuard…) và guard đó fail-closed. */
  | "OTHER_GUARD"
  /** Mở cho mọi user trong tenant, CÓ CHỦ ĐÍCH: dữ liệu cơ cấu/danh mục, đã tenant-scope qua CompanyGuard. */
  | "TENANT_READ"
  /** Handler luôn trả 410 Gone — không đọc/ghi gì. */
  | "DEAD-410"
  /** Module đã PARK theo de-media-fy (CLAUDE.md §1) — không phát triển, không xoá đợt này. */
  | "PARKED"
  /** LỖ ĐÃ BIẾT. Bắt buộc có `wo`. Không được dùng làm chỗ trú cho route mới. */
  | "GAP";

export interface RouteVerdict {
  verdict: Verdict;
  /** Lý do viết thành câu — người đọc phải hiểu được vì sao route này an toàn (hoặc vì sao chưa). */
  reason: string;
  /** Bắt buộc với `GAP`: Work Order / known-issue đang mở để đóng lỗ. */
  wo?: string;
}

/**
 * PHỤ LỤC A — 55 route (43 không gate + 12 `@Public`), sinh từ census runtime ngày 2026-07-27.
 * Đối chiếu tổng số với artifact `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`.
 */
export const ROUTE_VERDICTS: Readonly<Record<string, RouteVerdict>> = {
  // ── AuthController — SELF (8): chuỗi guard toàn cục đã ép đăng nhập; service lấy chủ thể từ token ──
  "AuthController#changePassword": {
    verdict: "SELF",
    reason:
      "Đổi mật khẩu của CHÍNH mình — service nhận req.user.id từ token, không nhận userId từ body (auth.controller.ts:188).",
  },
  "AuthController#enrollTwoFactor": {
    verdict: "SELF",
    reason: "Ghi danh TOTP cho chính chủ thể trong token; không tham chiếu user nào khác.",
  },
  "AuthController#enableTwoFactor": {
    verdict: "SELF",
    reason: "Bật 2FA cho chính mình sau khi xác nhận mã vừa ghi danh.",
  },
  "AuthController#disableTwoFactor": {
    verdict: "SELF",
    reason:
      "Tắt 2FA của chính mình; vẫn bị chặn thêm bởi role.requires_two_factor ở tầng service (không phải quyền).",
  },
  "AuthController#twoFactorStatus": {
    verdict: "SELF",
    reason: "Đọc trạng thái 2FA của chính chủ thể trong token.",
  },
  "AuthController#listSessions": {
    verdict: "SELF",
    reason: "Liệt kê phiên của chính mình — truy vấn WHERE user_id = token.sub.",
  },
  "AuthController#revokeSession": {
    verdict: "SELF",
    reason:
      "Thu hồi MỘT phiên của chính mình; :id được đối chiếu với user trong token trước khi thu hồi.",
  },
  "AuthController#revokeOtherSessions": {
    verdict: "SELF",
    reason: "Thu hồi mọi phiên KHÁC của chính mình; phạm vi suy ra hoàn toàn từ token.",
  },

  // ── AuthController — PUBLIC (8): pre-auth hoặc tự chứng thực trong handler ──────────────────────
  "AuthController#login": {
    verdict: "PUBLIC",
    reason: "Cửa vào — chưa thể có token. Chứng thực chính là email+mật khẩu trong body.",
  },
  "AuthController#refresh": {
    verdict: "PUBLIC",
    reason: "Refresh cookie CHÍNH LÀ chứng thực; access token đã hết hạn nên không thể qua JwtAuthGuard.",
  },
  "AuthController#logout": {
    verdict: "PUBLIC",
    reason:
      "Tháo phiên, idempotent, không đọc/trả dữ liệu nghiệp vụ. Phải gọi được cả khi token đã hết hạn (nếu không, người dùng kẹt phiên chết).",
  },
  "AuthController#me": {
    verdict: "PUBLIC",
    reason:
      "@Public nhưng handler TỰ verify access token (auth.controller.ts:155-161) — vẫn bắt buộc token hợp lệ, không hạ bảo mật; đặt @Public để tự kiểm soát mã lỗi thay vì 401 của guard.",
  },
  "AuthController#redirectAllowed": {
    verdict: "PUBLIC",
    reason:
      "Kiểm allowlist origin chống open-redirect, gọi TRƯỚC khi đăng nhập (FS-1a); chỉ trả boolean, không chạm DB nghiệp vụ.",
  },
  "AuthController#forgotPassword": {
    verdict: "PUBLIC",
    reason:
      "Pre-auth theo bản chất. Trả `{ok:true}` bất kể email tồn tại hay không ⇒ không làm kênh dò tài khoản.",
  },
  "AuthController#resetPassword": {
    verdict: "PUBLIC",
    reason: "Token đặt lại mật khẩu trong body CHÍNH LÀ chứng thực; người dùng chưa có phiên.",
  },
  "AuthController#verifyTwoFactor": {
    verdict: "PUBLIC",
    reason:
      "Bước 2 của login: challengeToken + mã TOTP/recovery là chứng thực; access token chưa được cấp ở bước này.",
  },

  // ── HealthController — PUBLIC (2) ──────────────────────────────────────────────────────────────
  "HealthController#health": {
    verdict: "PUBLIC",
    reason: "Probe hạ tầng (@Public cấp class, health.controller.ts:5) — không trả dữ liệu nghiệp vụ.",
  },
  "HealthController#healthDb": {
    verdict: "PUBLIC",
    reason: "Probe kết nối DB — trả trạng thái up/down, không trả nội dung bảng nào.",
  },

  // ── OTHER_GUARD (3): guard khác PermissionGuard, đều fail-closed ────────────────────────────────
  "InternalNotificationsController#intake": {
    verdict: "OTHER_GUARD",
    reason:
      "InternalGuard cấp class đòi x-internal-key khớp INTERNAL_API_KEY và fail-CLOSED khi biến chưa đặt (internal.guard.ts:23-29); vẫn nằm sau JwtAuthGuard + CompanyGuard toàn cục.",
  },
  "InternalDashboardCacheController#invalidate": {
    verdict: "OTHER_GUARD",
    reason: "Cùng InternalGuard cấp class như intake ở trên — caller máy trong-tiến-trình.",
  },
  "LmsNotificationsController#intake": {
    verdict: "OTHER_GUARD",
    reason:
      "@Public CỐ Ý (caller là MÁY ngoài tiến trình, không có JWT người dùng); LmsServiceIntakeGuard cấp class là hàng rào DUY NHẤT và fail-closed ở mọi nhánh (thiếu env · sai token · vượt hạn mức). company_id lấy server-side từ LMS_COMPANY_ID, body nêu company_id → 400.",
  },

  // ── PUBLIC có token-là-chứng-thực (1) ──────────────────────────────────────────────────────────
  "UserInvitesController#accept": {
    verdict: "PUBLIC",
    reason:
      "Token kích hoạt trong body là chứng thực — người được mời CHƯA có phiên. ⚠ Đọc lướt sẽ tưởng route này được gác: class CÓ @UseGuards(PermissionGuard) (user-invites.controller.ts:41) nhưng @Public trên handler khiến MỌI guard bỏ qua. Sổ này ghi theo hành vi runtime, không theo decorator cấp class.",
  },

  // ── SELF ngoài AuthController (7) ──────────────────────────────────────────────────────────────
  "UsersController#updateMe": {
    verdict: "SELF",
    reason: "PATCH hồ sơ của chính mình — repository ép WHERE id = req.user.id (users.controller.ts:27).",
  },
  "ApprovalInboxController#inbox": {
    verdict: "SELF",
    reason: "Hộp thư phê duyệt own-scope: chỉ trả yêu cầu mà chính người gọi là người duyệt.",
  },
  "ModuleCatalogController#myApps": {
    verdict: "SELF",
    reason:
      "Lọc theo QUYỀN CỦA CHÍNH user gọi (khoá bởi T my-apps-canonical-role.int-spec:124) — gate thêm sẽ thành vòng lặp: cần quyền để biết mình có quyền gì.",
  },
  "NotificationsController#listPreferences": {
    verdict: "SELF",
    reason: "Tuỳ chọn thông báo của chính mình; khoá theo user_id trong token.",
  },
  "NotificationsController#upsertPreference": {
    verdict: "SELF",
    reason: "Ghi tuỳ chọn thông báo của chính mình; không nhận userId từ body.",
  },
  "NotificationsController#registerDevice": {
    verdict: "SELF",
    reason: "Đăng ký device-token đẩy cho chính mình.",
  },
  "NotificationsController#unregisterDevice": {
    verdict: "SELF",
    reason: "Gỡ device-token của chính mình; :token được đối chiếu với chủ sở hữu trước khi xoá.",
  },

  // ── TENANT_READ (6): mở cho mọi user trong tenant, CÓ CHỦ ĐÍCH ──────────────────────────────────
  "SettingsController#getPublic": {
    verdict: "TENANT_READ",
    reason:
      "TUYỆT ĐỐI KHÔNG @Public (mất JWT là vỡ cô lập tenant). Chỉ trả setting is_public && !is_sensitive, đã drop secret qua setting-mask.toPublicMap; withTenant(req.user.companyId) giữ BẤT BIẾN #1.",
  },
  "CompanyBrandingController#getBranding": {
    verdict: "TENANT_READ",
    reason:
      "Owner chốt ở S5-BRAND-FE-2: logo/favicon hiển thị trên vỏ app cho MỌI nhân viên. Gate view:foundation-company (DB thật chỉ cấp cho company-admin) sẽ khiến tính năng chỉ chạy cho ~1 người/công ty. Đường GHI của controller này vẫn gate đủ 4/4.",
  },
  "OrgController#listOrgUnits": {
    verdict: "TENANT_READ",
    reason: "Cơ cấu tổ chức (phòng ban) — danh mục, không phải danh bạ người. Đã tenant-scope.",
  },
  "OrgController#getOrgTree": {
    verdict: "TENANT_READ",
    reason:
      "Sơ đồ tổ chức. GIỮ MỞ có chủ đích: apps/app dùng ở routes/hr/org-chart/OrgChartPage.tsx và layouts/workspace/TaskSidebarTree.tsx ⇒ siết cùng nhát với /org/employees sẽ gãy UI của mọi nhân viên.",
  },
  "OrgController#listDepartmentsLegacy": {
    verdict: "TENANT_READ",
    reason: "Bí danh cũ của /org/units — cùng dữ liệu cơ cấu, cùng lý do.",
  },
  "OrgController#listRoles": {
    verdict: "TENANT_READ",
    reason:
      "Danh mục vai trò (đã loại role operator-plane) — cần cho ô chọn vai trò ở FE; không lộ ai đang giữ vai trò nào.",
  },

  // ── GAP (3) — KI-030, đóng bởi S6-SEC-ORG-1 ────────────────────────────────────────────────────
  "OrgController#listEmployees": {
    verdict: "GAP",
    reason:
      "Trả danh bạ TOÀN TENANT (id·email·fullName·status + team membership của mọi user chưa xoá — org.repository.ts:322) cho MỌI user đã đăng nhập, trong khi /hr/employees cùng dữ liệu thì ép data_scope. Đây là SEC-F04.",
    wo: "S6-SEC-ORG-1 (KI-030)",
  },
  "OrgController#listTeams": {
    verdict: "GAP",
    reason:
      "Cùng họ với listEmployees — lộ cơ cấu team toàn tenant không gate. Sweep cũ không thấy vì nó lọc bỏ GET.",
    wo: "S6-SEC-ORG-1 (KI-030)",
  },
  "OrgController#listTeamMembers": {
    verdict: "GAP",
    reason:
      "Lộ THÀNH VIÊN từng team cho mọi user đã đăng nhập. Chính route này bị bẫy 'cửa sổ decorator i+8' của §0.4 nuốt mất ⇒ không xuất hiện trong bản census tĩnh nào.",
    wo: "S6-SEC-ORG-1 (KI-030)",
  },

  // ── DEAD-410 (4) ───────────────────────────────────────────────────────────────────────────────
  "TaskAttachmentsController#createIntent": {
    verdict: "DEAD-410",
    reason: "Handler luôn `return gone()` (task-attachments.controller.ts:39-60); khoá bởi T legacy-attachments-lock.int-spec.",
  },
  "TaskAttachmentsController#list": {
    verdict: "DEAD-410",
    reason: "Luôn 410 — không đọc bảng nào.",
  },
  "TaskAttachmentsController#download": {
    verdict: "DEAD-410",
    reason: "Luôn 410 — đường tải thật đã chuyển sang foundation-file.",
  },
  "TaskAttachmentsController#remove": {
    verdict: "DEAD-410",
    reason: "Luôn 410 — không ghi bảng nào.",
  },

  // ── PARKED (13): module CONTENT/media đã park theo de-media-fy ──────────────────────────────────
  // ⚠ Vẫn MOUNTED ở PROD: user đã đăng nhập gọi được. Rủi ro thực tế thấp (content_items không có dữ
  // liệu nghiệp vụ MVP) nhưng đây là bề mặt tấn công không cần thiết — đề xuất owner gỡ mount hoặc
  // gate cấp class trước RC (giữ nguyên khuyến nghị của báo cáo S6-SEC-1 §7).
  "WorkflowController#startWorkflow": { verdict: "PARKED", reason: "workflow của content_items (quyền update:content) — module CONTENT đã park." },
  "WorkflowController#getWorkflow": { verdict: "PARKED", reason: "Đọc workflow instance của content_items — module CONTENT đã park." },
  "WorkflowController#getWorkflowByContent": { verdict: "PARKED", reason: "Tra workflow theo contentItemId — module CONTENT đã park." },
  "WorkflowController#startStep": { verdict: "PARKED", reason: "Bước workflow content — module CONTENT đã park." },
  "WorkflowController#submitStep": { verdict: "PARKED", reason: "Bước workflow content — module CONTENT đã park." },
  "WorkflowController#getStepChecklist": { verdict: "PARKED", reason: "Checklist bước workflow content — module CONTENT đã park." },
  "WorkflowController#checkItem": { verdict: "PARKED", reason: "Tick checklist content — module CONTENT đã park." },
  "WorkflowController#uncheckItem": { verdict: "PARKED", reason: "Bỏ tick checklist content — module CONTENT đã park." },
  "WorkflowController#listApprovalRequests": { verdict: "PARKED", reason: "Duyệt content (KHÔNG phải FSM nghỉ phép/chấm công — cái đó ở ApprovalInboxController) — module CONTENT đã park." },
  "WorkflowController#approve": { verdict: "PARKED", reason: "Duyệt content — module CONTENT đã park." },
  "WorkflowController#requestRevision": { verdict: "PARKED", reason: "Trả lại content để sửa — module CONTENT đã park." },
  "WorkflowTemplatesController#list": { verdict: "PARKED", reason: "Mẫu workflow-DAG của content — module CONTENT đã park (mutation của controller này VẪN gate workflow-template)." },
  "WorkflowTemplatesController#detail": { verdict: "PARKED", reason: "Chi tiết mẫu workflow-DAG của content — module CONTENT đã park." },
};

/**
 * ĐÓNG BĂNG danh sách `GAP`. Test khoá đúng tập này, không khoá số đếm: thêm một lỗ mới ⇒ ĐỎ, và
 * đóng một lỗ mà quên cập nhật ⇒ cũng ĐỎ. Sửa danh sách này là việc của WO đóng/mở lỗ, kèm bằng chứng.
 */
export const FROZEN_GAPS: readonly string[] = [
  "OrgController#listEmployees",
  "OrgController#listTeamMembers",
  "OrgController#listTeams",
];

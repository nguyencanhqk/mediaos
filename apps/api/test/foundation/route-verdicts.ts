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
 * PHỤ LỤC A — 53 route (41 không gate + 12 `@Public`), sinh từ census runtime ngày 2026-08-20.
 * Đối chiếu tổng số với artifact `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`.
 *
 * Lịch sử con số: bản đầu (S6-SEC-ROUTEMAP-1) là **55** = 43 không gate + 12 `@Public`.
 * S6-SEC-ORG-1 gate 3 route `/org` (KI-030) ⇒ chúng rời tập này ⇒ **52** = 40 + 12.
 * S10-AUTH-STEPUP-1 thêm `POST /auth/step-up` (SELF, không `@RequirePermission`) ⇒ **53** = 41 + 12.
 * Phân bố ô hiện tại: SELF 16 · PUBLIC 11 · OTHER_GUARD 3 · TENANT_READ 6 · DEAD-410 4 · PARKED 13 ·
 * **GAP 0**.
 */
export const ROUTE_VERDICTS: Readonly<Record<string, RouteVerdict>> = {
  // ── AuthController — SELF (9): chuỗi guard toàn cục đã ép đăng nhập; service lấy chủ thể từ token ──
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
  // S10-AUTH-STEPUP-1 (APPEND — 20/08/2026): xác thực lại bằng TOTP để mở cửa sổ re-auth.
  "AuthController#stepUp": {
    verdict: "SELF",
    reason:
      "Xác thực lại bằng TOTP của CHÍNH mình: service nhận { id, companyId } TỪ req.user (token), " +
      "KHÔNG nhận userId/companyId từ body (auth.controller.ts:308-311) — không có tham số nào trỏ " +
      "sang chủ thể khác. KHÔNG @RequirePermission có chủ đích: quyền để LÀM gì đó vẫn do PermissionGuard " +
      "của route tiêu thụ quyết định; endpoint này chỉ mở một CỬA SỔ khoá theo bộ-5 " +
      "(companyId,userId,action,resourceType,resourceId) — cửa sổ mint được KHÔNG cấp thêm quyền nào " +
      "(permission.decide.ts vẫn đòi object grant), và cặp phải nằm trong REVEAL_CLASS_PAIRS (hôm nay RỖNG).",
  },

  // ── AuthController — PUBLIC (8): pre-auth hoặc tự chứng thực trong handler ──────────────────────
  "AuthController#login": {
    verdict: "PUBLIC",
    reason: "Cửa vào — chưa thể có token. Chứng thực chính là email+mật khẩu trong body.",
  },
  "AuthController#refresh": {
    verdict: "PUBLIC",
    reason:
      "Refresh cookie CHÍNH LÀ chứng thực; access token đã hết hạn nên không thể qua JwtAuthGuard.",
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
    reason:
      "Probe hạ tầng (@Public cấp class, health.controller.ts:5) — không trả dữ liệu nghiệp vụ.",
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
    reason:
      "PATCH hồ sơ của chính mình — repository ép WHERE id = req.user.id (users.controller.ts:27).",
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
    reason:
      "Cơ cấu tổ chức (phòng ban): tên + mã + loại + trạng thái, KÈM họ tên trưởng đơn vị (org.repository.ts listOrgUnits chiếu headUserName). KHÔNG email, KHÔNG liệt kê nhân sự thường ⇒ vẫn là danh mục cơ cấu, không phải danh bạ. Đã tenant-scope.",
  },
  "OrgController#getOrgTree": {
    verdict: "TENANT_READ",
    reason:
      "Sơ đồ tổ chức: hình dạng cây + họ tên TRƯỞNG đơn vị (headUserName) + headcount từng đơn vị (employeeCount). GIỮ MỞ có chủ đích: apps/app dùng qua packages/web-core hr-org-api ở routes/hr/org-chart/OrgChartPage.tsx và layouts/workspace/TaskSidebarTree.tsx ⇒ siết cùng nhát với /org/employees sẽ gãy UI của mọi nhân viên.",
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

  // ── GAP (0) — KI-030 ĐÃ ĐÓNG bởi S6-SEC-ORG-1 (2026-07-27) ─────────────────────────────────────
  // Ba dòng từng ở đây (`OrgController#listEmployees` · `#listTeams` · `#listTeamMembers`) đã được GỠ
  // vì nợ đã trả, không phải vì ai đó dọn cho xanh: cả ba nay mang `@UseGuards(PermissionGuard)` +
  // `@RequirePermission` (`view:user` cho employees — S6-SEC-PERMVERB-1 đổi từ legacy `read:user`,
  // xem DECISIONS-06; `read:team` cho hai route team) nên chúng RỜI tập
  // "route không gate" ⇒ giữ dòng lại sẽ làm ĐỎ test "nợ trả rồi thì gỡ" (luật 4 ở đầu file).
  // Bằng chứng RED→GREEN: `test/integration/org-directory-permission.int-spec.ts`.
  //
  // `FROZEN_GAPS` ở cuối file theo đó về rỗng: sổ này hiện KHÔNG còn lỗ bảo mật đã biết nào.

  // ── DEAD-410 (4) ───────────────────────────────────────────────────────────────────────────────
  "TaskAttachmentsController#createIntent": {
    verdict: "DEAD-410",
    reason:
      "Handler luôn `return gone()` (task-attachments.controller.ts:39-60); khoá bởi T legacy-attachments-lock.int-spec.",
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

  // ── PARKED (0): khối 13 route `workflow/` ĐÃ BIẾN MẤT khỏi census ────────────────────────────
  // `S10-CLEAN-WORKFLOWPARK-1` (27/08/2026) GỠ HẲN `WorkflowController` + `WorkflowTemplatesController`
  // khỏi `AppModule` — đúng khuyến nghị "gỡ mount trước RC" mà báo cáo `S6-SEC-1` §7 để lại và khối
  // này từng ghi. Không còn route ⇒ không còn gì để phán quyết: giữ lại 13 dòng sẽ làm ca "sổ trỏ
  // route CÓ THẬT" đỏ, và tệ hơn là khiến người đọc sau tưởng bề mặt đó vẫn sống ở PROD.
  //
  // ⛔ Đừng thêm lại ô PARKED cho `workflow/`. Bề mặt HTTP của nó = 0, có ca đo riêng khẳng định
  // điều đó: `test/foundation/workflow-surface-removed.unit-spec.ts`.
};

/**
 * ĐÓNG BĂNG danh sách `GAP`. Test khoá đúng tập này, không khoá số đếm: thêm một lỗ mới ⇒ ĐỎ, và
 * đóng một lỗ mà quên cập nhật ⇒ cũng ĐỎ. Sửa danh sách này là việc của WO đóng/mở lỗ, kèm bằng chứng.
 */
export const FROZEN_GAPS: readonly string[] = [
  // RỖNG kể từ S6-SEC-ORG-1 (2026-07-27) — KI-030 đã đóng, xem khối "GAP (0)" ở trên.
  //
  // Danh sách rỗng KHÔNG làm lưới yếu đi, nó làm lưới CHẶT NHẤT có thể: mọi route không gate từ nay
  // phải rơi vào 6 ô còn lại (SELF · PUBLIC · OTHER_GUARD · TENANT_READ · DEAD-410 · PARKED). Muốn
  // thêm một dòng `GAP` là phải sửa chính mảng này ⇒ không ai nhận thêm nợ bảo mật trong im lặng.
];

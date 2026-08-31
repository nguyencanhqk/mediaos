/**
 * S6-SEC-IDENTITY-PROJ-1 — SỔ PHÁN QUYẾT cho mọi điểm CHIẾU danh tính người.
 *
 * LUẬT: **mọi** điểm `PROJECTION` mà `identity-projection-census.ts` tìm thấy phải có ĐÚNG MỘT dòng ở
 * đây. Không có ô thứ hai — kể cả điểm đã vá đúng bằng `identityColumns()` cũng phải có dòng
 * (`basis: "identity-gated"`). Điểm mới không có dòng ⇒ `identity-projection-ratchet.unit-spec.ts` ĐỎ.
 *
 * ⚠️ VÌ SAO KHÔNG có ngoại lệ "hàm này đã gọi `identityColumns` rồi thì miễn":
 * scanner chỉ chứng minh được *hàm CÓ GỌI*, không chứng minh được *cột của ĐIỂM ĐÓ* đi qua nó. Một
 * hàm bọc một cột và để cột bên cạnh trần vẫn qua được điều kiện ấy — tức ratchet sẽ **cấp giấy thông
 * hành** cho đúng lớp lỗ KI-052 ("cột bên cạnh trong cùng file", `S6-SEC-IDENTITYBOUND-1`). Nên
 * ngoại lệ đó bị bỏ hẳn, đổi lấy 71 dòng phải viết tay một lần.
 *
 * ⚠️ THÊM DÒNG = TUYÊN BỐ CÓ CHỦ ĐÍCH, phải qua FULL gate. Mặc định của một điểm chiếu mới là **VÁ**
 * (cho nó nhận `IdentityGrant`), KHÔNG phải xin một dòng ở đây.
 *
 * `signedBy` = mã Work Order (khuôn `fk-tenant-verdicts.ts`).
 */

/**
 * Căn cứ. Bảy giá trị đầu là `IdentityBasis` của `src/permission/identity-projection.ts`; `order-only`
 * chỉ tồn tại ở sổ này (xem dòng `SORT_COLUMNS`).
 *
 * Bốn căn cứ **KHÔNG đo được bằng máy** — `waiver` · `no-actor` · `second-assert` · `self-bound-route`
 * — đều có TRẦN ĐẾM ở `BASIS_CEILINGS`. Ba căn cứ còn lại mang một vị từ SQL thật nên tự nó là bằng
 * chứng; không cần trần.
 */
export type VerdictBasis =
  | "scoped-predicate"
  | "identity-gated"
  | "self-bound-row"
  | "self-bound-route"
  | "second-assert"
  | "membership"
  | "no-actor"
  | "waiver"
  | "order-only";

export interface IdentityVerdict {
  /** Khoá `file#fn:expr` — khớp `pointKey()` của census. */
  readonly point: string;
  readonly basis: VerdictBasis;
  /** Câu này là thứ người sau đọc. Viết cho người, kèm file:dòng của BẰNG CHỨNG. */
  readonly reason: string;
  readonly signedBy: string;
}

const WO = "S6-SEC-IDENTITY-PROJ-1";

export const IDENTITY_VERDICTS: readonly IdentityVerdict[] = [
  // ── attendance ──────────────────────────────────────────────────────────────
  {
    point: "attendance/attendance-adjustment.repository.ts#REQUEST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "attendance-adjustment.service.ts:292-302 — resolveAndAssert rồi buildEmployeeScopeCondition; `listTx` nhận `scopeConds` (hoặc self-lock cho luồng 'của tôi'). Danh tính là của CHÍNH chủ thể hàng đã lọc.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance-alert-noti.repository.ts#fetchLateRowsTx:users.fullName",
    basis: "no-actor",
    reason:
      "Job cảnh báo chấm công (scheduler) — không có actor HTTP nào để resolve scope. Tên đi vào payload NOTI của chính người bị cảnh báo.",
    signedBy: WO,
  },
  {
    point:
      "attendance/attendance-alert-noti.repository.ts#fetchMissingCheckoutRowsTx:users.fullName",
    basis: "no-actor",
    reason:
      "Job quét thiếu check-out (scheduler, attendance-alert-noti.repository.ts:193) — không có actor HTTP để resolve scope. Tên đi vào payload NOTI gửi cho chính người bị nhắc.",
    signedBy: WO,
  },
  {
    point:
      "attendance/attendance-alert-noti.repository.ts#materializeAbsentCandidatesTx:users.fullName",
    basis: "no-actor",
    reason:
      "Job dựng danh sách vắng (attendance-alert-noti.repository.ts:282) — không có actor HTTP. Tên đi vào payload NOTI của chính người vắng, không phải một danh bạ trả cho ai đọc.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance-read.repository.ts#RECORD_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "attendance-read.repository.ts:211-240 `runList` nhận `rowCond` — hoặc vị từ data_scope (list công ty/nhóm) hoặc `eq(attendanceRecords.userId, userId)` (`listMyRecordsTx`). Không có đường gọi nào không truyền vị từ.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance-report.repository.ts#listReportTx:users.fullName",
    basis: "scoped-predicate",
    reason:
      "attendance-report.service.ts:40-62 — resolveAndAssert(isSensitive) + buildEmployeeScopeCondition, `scopeCond` là tham số BẮT BUỘC của listReportTx.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance.repository.ts#findRecordsByMonth:users.fullName",
    basis: "self-bound-row",
    reason:
      "attendance.service.ts:457-463 — `userId: query.userId ?? actor.id`, và `query.userId !== actor.id` phải qua `assertCanManage` TRƯỚC. Tập hàng ghim vào actor trừ khi có quyền quản lý.",
    signedBy: WO,
  },
  {
    point: "attendance/remote-work-request.repository.ts#REQUEST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "remote-work-request.service.ts:288-298 — resolveAndAssert + buildEmployeeScopeCondition; luồng 'của tôi' dùng `ownScopeCond` (:256).",
    signedBy: WO,
  },

  // ── auth (self) ─────────────────────────────────────────────────────────────
  {
    point: "auth/auth.service.ts#completeTwoFactorLogin:users.email",
    basis: "self-bound-route",
    reason:
      "auth.service.ts:503 `eq(users.id, claims.sub)` — bước 2 của đăng nhập, chủ thể là chính người đang đăng nhập. Không có đường truyền id của người khác.",
    signedBy: WO,
  },
  {
    point: "auth/auth.service.ts#recordLoginAttemptForUser:users.email",
    basis: "self-bound-route",
    reason:
      "S10-SEC-LOGINLOG429-1 (KI-047). `eq(users.id, args.userId)` — CÙNG hình dạng và cùng nguồn " +
      "với dòng `completeTwoFactorLogin:users.email` ngay trên: cả BA lời gọi đều truyền `claims.sub` " +
      "lấy từ challengeToken ĐÃ verify (auth.service.ts nhánh replay · nhánh 429 · nhánh mã sai), " +
      "không có đường nào truyền id của người khác vào. Email đọc ra KHÔNG đi tới caller: nó chỉ rơi " +
      "vào `login_logs.email` — cột vốn đã chứa email do client tự khai — và bề mặt ĐỌC lại của cột " +
      "đó (AUTH-API-401) gác danh tính riêng qua `LoginLogGrants.identity`, không qua điểm này.",
    signedBy: "S10-SEC-LOGINLOG429-1",
  },
  {
    point: "auth/auth.service.ts#me:users.email",
    basis: "self-bound-route",
    reason:
      "auth.service.ts:1096-1110 bootstrap `/auth/me` — `eq(users.id, claims.sub)` từ token, không nhận tham số.",
    signedBy: WO,
  },
  {
    point: "auth/auth.service.ts#me:users.fullName",
    basis: "self-bound-route",
    reason:
      "auth.service.ts:1105 — cùng truy vấn bootstrap `/auth/me` với cột email ở dòng trên: `eq(users.id, claims.sub)` lấy từ token, route không nhận tham số id nào.",
    signedBy: WO,
  },
  {
    point: "auth/two-factor.service.ts#enroll:users.email",
    basis: "self-bound-route",
    reason:
      "two-factor.service.ts:166 `eq(users.id, userId)` với `userId` = actor đang enroll TOTP cho chính mình. Email dùng dựng nhãn otpauth.",
    signedBy: WO,
  },

  // ── chat ────────────────────────────────────────────────────────────────────
  {
    point: "chat/chat-attachments.repository.ts#listRoomFiles:users.fullName",
    basis: "membership",
    reason:
      "chat-attachments.service.ts:158 — `assertMember` TRƯỚC mọi thứ (404 chung). Người ngoài phòng không chạm được hàng nào.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#findSenderDisplayName:users.email",
    basis: "self-bound-row",
    reason:
      "chat-messages.service.ts:277 truyền `actor.id` — lấy tên hiển thị của CHÍNH người gửi để dựng payload NOTI.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#findSenderDisplayName:users.fullName",
    basis: "self-bound-row",
    reason:
      "chat-messages.repository.ts:518 — cùng truy vấn với cột email: chat-messages.service.ts:277 truyền `actor.id`, lấy tên hiển thị của CHÍNH người gửi để dựng payload NOTI.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#MESSAGE_COLUMNS:users.fullName",
    basis: "membership",
    reason:
      "Mọi đường đọc tin đi qua `ChatAccessService.assertMember`/`assertMessageAccess` (chat-access.service.ts:122,235) — điểm khẳng định membership DUY NHẤT của module.",
    signedBy: WO,
  },
  {
    point: "chat/chat-oversight.repository.ts#listActiveMembers:users.fullName",
    basis: "waiver",
    reason:
      "Đường GIÁM SÁT tuân thủ, cố ý nhìn xuyên membership. Gate `view:chat-oversight` isSensitive (chat-oversight.controller.ts:76-126); đo PROD 2026-08-19: CHỈ vai `SA` (2 user sống) giữ, @Company. Mỗi lần gọi ghi audit.",
    signedBy: WO,
  },
  {
    point: "chat/chat-oversight.repository.ts#listOversightAudit:users.fullName",
    basis: "waiver",
    reason:
      "Như trên — nhật ký ai đã dùng quyền giám sát; tên người giám sát là nội dung của chính bản ghi.",
    signedBy: WO,
  },
  {
    point: "chat/chat-oversight.repository.ts#OVERSIGHT_MESSAGE_COLUMNS:users.fullName",
    basis: "waiver",
    reason: "Như trên — nội dung tin dưới quyền giám sát.",
    signedBy: WO,
  },
  {
    point: "chat/chat-rooms.repository.ts#listActiveMembers:users.fullName",
    basis: "membership",
    reason:
      "chat-rooms.service.ts:138 + chat-members.service.ts:341 — cả hai sau `assertMember` (đường thứ hai là đọc-lại-sau-ghi, thao tác ghi đã gate).",
    signedBy: WO,
  },
  {
    point: "chat/chat-rooms.repository.ts#listRosterMembers:users.fullName",
    basis: "membership",
    reason: "chat-members.service.ts:68 — `assertMember` ngay trên lời gọi.",
    signedBy: WO,
  },
  {
    point: "chat/chat-search.repository.ts#search:users.fullName",
    basis: "membership",
    reason:
      "chat-search.service.ts:53 — chế độ MỘT phòng qua `assertMember`; chế độ mọi phòng thì `repo.search(tx, companyId, actor.id, …)` tự innerJoin membership của actor (chat-search.repository.ts docblock §495-528).",
    signedBy: WO,
  },

  // ── employees ───────────────────────────────────────────────────────────────
  {
    point: "employees/employees.repository.ts#DETAIL_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason:
      "employees.service.ts:130-150 — resolveAndAssert rồi `isEmployeeInScope` cho hàng đơn; list đi qua :95-108 với `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#DETAIL_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "Cùng bản đồ cột DETAIL_COLUMNS với cột email: employees.service.ts:130-150 resolveAndAssert rồi `isEmployeeInScope` cho hàng đơn — hồ sơ ngoài scope không tới được lời chiếu.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#LIST_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason:
      "employees.service.ts:95-108 — resolveAndAssert + buildEmployeeScopeCondition; `listEmployeesTx` nhận `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#LIST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "Cùng bản đồ cột LIST_COLUMNS với cột email: employees.service.ts:95-108 resolveAndAssert + buildEmployeeScopeCondition, `listEmployeesTx` nhận `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/hr-org-chart.repository.ts#listScopedActiveTx:users.fullName",
    basis: "scoped-predicate",
    reason:
      "hr-org-chart.service.ts:47-58 — resolveAndAssert + buildEmployeeScopeCondition, `scopeCond` là tham số BẮT BUỘC.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:directManagerUsers.fullName",
    basis: "scoped-predicate",
    reason:
      "alias(users,'direct_manager_users') — tên quản lý trực tiếp của CHÍNH hồ sơ đã lọc theo scope (hr-read.service.ts:186 resolveAndAssert). Đường quan hệ, không phải danh bạ độc lập.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:indirectManagerUsers.fullName",
    basis: "scoped-predicate",
    reason: "Như trên — alias(users,'indirect_manager_users').",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason:
      "hr-read.service.ts:186 — resolveAndAssert trước khi đọc chi tiết; hàng ngoài scope không tới được.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "Cùng bản đồ cột DETAIL_COLUMNS với cột email: hr-read.service.ts:186 resolveAndAssert trước khi đọc chi tiết; hàng ngoài scope không tới được.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#LIST_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason:
      "hr-read.service.ts:93-104 — resolveAndAssert + buildEmployeeScopeCondition; `listScopedTx(tx, companyId, scopeCond, …)`.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#LIST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason:
      "Cùng bản đồ cột LIST_COLUMNS với cột email: hr-read.service.ts:93-104 resolveAndAssert + buildEmployeeScopeCondition, `listScopedTx` nhận `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#SORT_COLUMNS:users.fullName",
    basis: "order-only",
    reason:
      "Bản đồ cột SẮP XẾP, không phải cột chiếu — census xếp nhầm vào PROJECTION vì nó là object literal. Cột này đi vào ORDER BY của truy vấn ĐÃ bound scope (cùng `scopeCond` với LIST_COLUMNS) nên không dựng oracle: mọi hàng sắp được đều là hàng người gọi được xem.",
    signedBy: WO,
  },
  {
    point: "employees/profile-change-request.repository.ts#findUserNameTx:users.fullName",
    basis: "waiver",
    reason:
      "profile-change-request.service.ts:261 — tên NGƯỜI DUYỆT hiện trên đơn của chính người nộp. Cố ý: người nộp phải biết ai đã duyệt/từ chối đơn mình. Một người, đã có quan hệ nghiệp vụ trực tiếp, không phải danh bạ.",
    signedBy: WO,
  },

  // ── integrations/lms ────────────────────────────────────────────────────────
  {
    point: "integrations/lms/lms-sync-producer.service.ts#enqueueSync:users.email",
    basis: "no-actor",
    reason:
      "Producer outbox đồng bộ tài khoản sang LMS — chạy trong tx nghiệp vụ, không có actor HTTP. Đích đến là hệ LMS nội bộ đã ký SSO.",
    signedBy: WO,
  },
  {
    point: "integrations/lms/lms-sync-producer.service.ts#enqueueSync:users.fullName",
    basis: "no-actor",
    reason:
      "Cùng truy vấn producer outbox với cột email (lms-sync-producer.service.ts:49) — chạy trong tx nghiệp vụ, không actor HTTP; đích là hệ LMS nội bộ đã ký SSO.",
    signedBy: WO,
  },
  {
    point: "integrations/lms/lms-user-sync.job-handler.ts#run:users.email",
    basis: "no-actor",
    reason: "Job handler đồng bộ — chạy ở worker, không actor HTTP.",
    signedBy: WO,
  },
  {
    point: "integrations/lms/lms-user-sync.job-handler.ts#run:users.fullName",
    basis: "no-actor",
    reason:
      "Cùng truy vấn job handler với cột email (lms-user-sync.job-handler.ts:96) — chạy ở worker, không actor HTTP.",
    signedBy: WO,
  },

  // ── leave ───────────────────────────────────────────────────────────────────
  {
    point: "leave/leave-approval.repository.ts#listPendingScopedTx:users.fullName",
    basis: "scoped-predicate",
    reason:
      "leave-approval.service.ts:104-116 — `scopeCond` là tham số BẮT BUỘC của cả `countPendingScopedTx` lẫn `listPendingScopedTx`.",
    signedBy: WO,
  },
  {
    point: "leave/leave-calendar.repository.ts#listScopedTx:users.fullName",
    basis: "scoped-predicate",
    reason: "leave-calendar.service.ts:54 — `listScopedTx(companyId, scopeCond, …)`.",
    signedBy: WO,
  },
  {
    point: "leave/leave-report.repository.ts#listReportTx:users.fullName",
    basis: "scoped-predicate",
    reason:
      "leave-report.service.ts:34-46 — resolveAndAssert('export', leave, isSensitive) + buildEmployeeScopeCondition; kèm audit-on-read trong cùng tx.",
    signedBy: WO,
  },
  {
    point: "leave/leave.repository.ts#findBalances:users.fullName",
    basis: "second-assert",
    reason:
      "leave.service.ts:122-128 — `scope=all` phải qua `assertCan('manage','leave')`; `scope=me` truyền `userId: actor.id`. Fail-closed, KHÔNG âm thầm thu hẹp về bản thân. Đo PROD 2026-08-19: vai `employee` (34/35 user) KHÔNG có `manage:leave`.",
    signedBy: WO,
  },
  {
    point: "leave/leave.repository.ts#findRequests:users.fullName",
    basis: "second-assert",
    reason:
      "leave.service.ts:163-182 — `scope=all` phải qua `assertCan('approve','leave')`; vai `employee` KHÔNG có cặp này.",
    signedBy: WO,
  },

  // ── me (self) ───────────────────────────────────────────────────────────────
  {
    point: "me/me.repository.ts#findAccountByUserIdTx:users.email",
    basis: "self-bound-route",
    reason:
      "me.repository.ts:78-85 `eq(users.id, userId)` với userId resolve từ token. `/me/*` theo định nghĩa chỉ phục vụ chính chủ.",
    signedBy: WO,
  },
  {
    point: "me/me.repository.ts#findAccountByUserIdTx:users.fullName",
    basis: "self-bound-route",
    reason:
      "me.repository.ts:80 — cùng truy vấn với cột email: `eq(users.id, userId)` token-resolved, `/me/*` theo định nghĩa chỉ phục vụ chính chủ.",
    signedBy: WO,
  },
  {
    point: "me/me.repository.ts#findActiveEmployeesByUserIdTx:users.fullName",
    basis: "self-bound-route",
    reason: "me.repository.ts:51-66 — `eq(employeeProfiles.userId, userId)` token-resolved.",
    signedBy: WO,
  },

  // ── org ─────────────────────────────────────────────────────────────────────
  {
    point: "org/org.repository.ts#getOrgTree:users.fullName",
    basis: "waiver",
    reason:
      "`headUserName` của đơn vị — phơi CÓ CHỦ ĐÍCH, chữ ký đã có ở test/foundation/route-verdicts.ts. Trưởng đơn vị là thông tin cơ cấu tổ chức, ai đọc được sơ đồ thì biết; không phải danh bạ toàn công ty.",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },
  {
    point: "org/org.repository.ts#listOrgUnits:users.fullName",
    basis: "waiver",
    reason: "Như trên — cùng cột `headUserName`, cùng chữ ký.",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },
  {
    point: "org/org.repository.ts#listEmployees:users.email",
    basis: "scoped-predicate",
    reason:
      "org.repository.ts:360 — `scopeCond: SQL` BẮT BUỘC, không giá trị mặc định (S6-SEC-ORGSCOPE-1/N-1: optional ở đây nghĩa là quên truyền thì lặng lẽ quay về hành vi rò cũ).",
    signedBy: "S6-SEC-ORGSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listEmployees:users.fullName",
    basis: "scoped-predicate",
    reason:
      "org.repository.ts:366 — cùng truy vấn với cột email: `scopeCond: SQL` là tham số BẮT BUỘC, không có giá trị mặc định (N-1).",
    signedBy: "S6-SEC-ORGSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeamMembers:users.email",
    basis: "identity-gated",
    reason:
      "org.repository.ts:285-291 — `case when (showIdentity)` với vị từ của cặp danh bạ `view:user`; org.service.ts:260-262 bỏ HẲN khoá khi ngoài scope (N-1c, KI-049).",
    signedBy: "S6-SEC-ORGTEAMSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeamMembers:users.fullName",
    basis: "identity-gated",
    reason:
      "org.repository.ts:288 — cùng cụm `case when (showIdentity)` với cột email; org.service.ts:260-262 bỏ HẲN khoá khi ngoài scope vì contract khai `.optional()` (N-1c, KI-049).",
    signedBy: "S6-SEC-ORGTEAMSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeams:users.fullName",
    basis: "identity-gated",
    reason:
      "org.repository.ts:183-186 `leaderUserName` — N-1e/KI-052. `null` KHÔNG dùng để mang tin (contract nullable hợp lệ vì team có thể chưa có trưởng nhóm) nên phải bỏ khoá qua `identityInScope`.",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },

  // ── recycle-bin ─────────────────────────────────────────────────────────────
  {
    point: "recycle-bin/recycle-bin.repository.ts#deletedColumns:users.email",
    basis: "identity-gated",
    reason:
      "recycle-bin.repository.ts:22-27 — `case when (showIdentity)`; `identityCond` là tham số BẮT BUỘC, `null` ⇒ `false` (N-1d, KI-051).",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },
  {
    point: "recycle-bin/recycle-bin.repository.ts#deletedColumns:users.fullName",
    basis: "identity-gated",
    reason:
      "recycle-bin.repository.ts:25 — cùng cụm `case when (showIdentity)` với cột email; `identityCond` BẮT BUỘC, `null` ⇒ `false` fail-closed (N-1d, KI-051).",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },

  // ── tasks ───────────────────────────────────────────────────────────────────
  {
    point: "tasks/projects.repository.ts#findDetailByIdTx:ownerUser.fullName",
    basis: "membership",
    reason:
      "projects.service.ts:148,164,181 truyền `scopeExists` — vị từ tồn-tại-thành-viên của dự án. Đường đọc-lại-sau-ghi (:1005) đi sau thao tác ghi đã gate.",
    signedBy: WO,
  },
  {
    point: "tasks/projects.repository.ts#listMembersTx:memberUser.fullName",
    basis: "membership",
    reason:
      "projects.service.ts:166 — gọi SAU `findDetailByIdTx(tx, …, scopeExists)`; không truy cập được dự án thì không tới được danh sách thành viên.",
    signedBy: WO,
  },
  {
    point: "tasks/projects.repository.ts#listTx:ownerUser.fullName",
    basis: "membership",
    reason: "projects.service.ts:127 — list dự án lọc theo `scopeExists`.",
    signedBy: WO,
  },
  {
    point: "tasks/task-activity-feed.repository.ts#listRowsTx:users.fullName",
    basis: "second-assert",
    reason:
      "task-activity-feed.service.ts:52-71 — hoặc giữ cặp `view:task-audit-log` (isSensitive) hoặc LÀ NGƯỜI LIÊN QUAN của đúng task đó (`isUserInvolvedTx`); không thuộc cả hai ⇒ 403 TASK-ERR-042.",
    signedBy: WO,
  },
  {
    point: "tasks/tasks.repository.ts#findCommentsByTaskId:users.fullName",
    basis: "waiver",
    reason:
      "tasks.service.ts:456-464 — @deprecated từ S4-TASK-BE-4: TasksController KHÔNG còn route nào gọi tới (bình luận đã chuyển sang TaskCommentsService có gate + data-scope). GIỮ để không phá tasks.service.spec.ts. Không có đường HTTP ⇒ không có actor để bound. Xoá hẳn thuộc WO dọn dẹp.",
    signedBy: WO,
  },

  // ── users ───────────────────────────────────────────────────────────────────
  {
    point: "users/auth-users.repository.ts#findManyTx:getTableColumns(users)",
    basis: "scoped-predicate",
    reason:
      "auth-users.repository.ts:111 nhận sẵn vị từ scope từ auth-users.service (cùng cặp `view:user` với /org/employees kể từ S6-SEC-PERMVERB-1). Spread TOÀN BỘ cột `users` — an toàn vì tập HÀNG đã bound; nhưng đây cũng là điểm mà scanner không thấy tên cột nào, xem `blindSpots()`.",
    signedBy: WO,
  },
  // ── ĐÃ VÁ trong chính WO này (KI-053 · KI-054 · KI-069) ─────────────────────
  {
    point: "permission/role-admin.repository.ts#listRoleMembersTx:users.email",
    basis: "identity-gated",
    reason:
      "KI-053 — role-admin.service.ts:113-140: `assertCan(view,user)` chỉ trả lời CÓ/KHÔNG, không đọc data_scope. Nay `resolveOrNull` + `buildUserScopeConditionOn(users)` dựng vị từ, `identityColumns` khử ở SQL, service BỎ HẲN khoá (contract `.optional()`). ORDER BY cũng đổi sang cột đã che để thứ tự không rò alphabet. ⟲ S10-SEC-ROLEMEMBERROW-1 (KI-071): route này nay bound CẢ TẬP HÀNG bằng CÙNG cặp `view:user` và CÙNG cặp cột (`users.id`/`users.companyId`) ⇒ mọi hàng trả về đều trong scope ⇒ cờ `identityInScope` LUÔN true và nhánh `else null` KHÔNG BAO GIỜ RẼ trên route này. Tầng cột được GIỮ (phòng thủ + nợ N-1b có thể nới vị từ HÀNG mà không nới vị từ CỘT) nhưng khả-quan-sát của nó ở đây bị BAO TRÙM — đừng đọc dòng này thành 'route còn hai lớp độc lập', và đừng nghiệm thu cơ chế bound-CỘT qua nó: bằng chứng độc lập sống ở `login_logs`/`user_security_events`.",
    signedBy: WO,
  },
  {
    point: "permission/role-admin.repository.ts#listRoleMembersTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-053 — cùng cụm `case when` với cột email; `fullName` cũng bị BỎ KHOÁ (không giữ `null`) vì `null` đã mang nghĩa 'user chưa đặt họ tên'. ⟲ S10-SEC-ROLEMEMBERROW-1 (KI-071): route này nay bound CẢ TẬP HÀNG bằng CÙNG cặp `view:user` và CÙNG cặp cột (`users.id`/`users.companyId`) ⇒ mọi hàng trả về đều trong scope ⇒ cờ `identityInScope` LUÔN true và nhánh `else null` KHÔNG BAO GIỜ RẼ trên route này. Tầng cột được GIỮ (phòng thủ + nợ N-1b có thể nới vị từ HÀNG mà không nới vị từ CỘT) nhưng khả-quan-sát của nó ở đây bị BAO TRÙM — đừng đọc dòng này thành 'route còn hai lớp độc lập', và đừng nghiệm thu cơ chế bound-CỘT qua nó: bằng chứng độc lập sống ở `login_logs`/`user_security_events`.",
    signedBy: WO,
  },
  {
    point: "auth/login-log.repository.ts#findManyTx:users.email",
    basis: "identity-gated",
    reason:
      "KI-054 — auth-logs-viewer.service.ts `identityGrantFrom()`: cặp GATE là `view:audit-log`, cặp BOUND là `view:user` ⇒ `resolveOrNull` (khuôn N-1c). Trước bản vá docstring ghi 'Company-scope' nhưng không có gì resolve data_scope. ⟲ S10-SEC-AUDITLOGROW-1 (KI-070): dòng này vẫn chỉ nói về CỘT — vế TẬP HÀNG nay do một grant RIÊNG `basis:'scoped-predicate'` dựng trên `login_logs.user_id` theo cặp `view:audit-log` đảm nhận, đi qua `rowScopeSql` chứ không qua `identityColumns` (nên nó KHÔNG phải một điểm chiếu và không có dòng ở sổ này).",
    signedBy: WO,
  },
  {
    point: "auth/login-log.repository.ts#findManyTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-054 — cùng cụm `case when` với cột email; `userRef()` ba nhánh phân biệt 'không gắn user' / 'ngoài scope' / 'user đã xoá'. ⟲ S10-SEC-AUDITLOGROW-1: tập hàng nay bị chặn riêng theo `view:audit-log` (KI-070) — hai tầng độc lập, đừng gộp.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:users.email",
    basis: "identity-gated",
    reason:
      "KI-054 — nhóm CHỦ THỂ, vị từ dựng trên `users.id`/`users.company_id`, cờ `identityInScope`. ⟲ S10-SEC-AUDITLOGROW-1 (KI-070): truy vấn này nay mang BA vị từ trên BA bảng — hàng (`user_security_events.user_id`), chủ thể (`users.id`), tác nhân (`sec_event_actor.id`) — nên grants truyền bằng OBJECT CÓ TÊN: ba giá trị cùng kiểu `IdentityGrant` phân biệt bằng vị trí thì hoán vị là hợp kiểu.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-054 — cùng nhóm CHỦ THỂ, cùng cụm `case when`, cùng cờ `identityInScope`. ⟲ S10-SEC-AUDITLOGROW-1: `Own` trên vị từ HÀNG bám CHỦ THỂ (`user_id`), CỐ Ý không `OR actor_user_id` — xem `security-event.repository.buildWhere`.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:actor.email",
    basis: "identity-gated",
    reason:
      "KI-054 — nhóm NGƯỜI GÂY RA, GRANT RIÊNG dựng trên `SECURITY_EVENT_ACTOR.id`/`.company_id`. Tái dùng vị từ của chủ thể vừa lộ actorEmail của người khác (hàng có chủ thể = tôi) vừa giấu email của chính tôi (hàng tôi là actor) — hai chiều đều sai. Cờ riêng `actorIdentityInScope` vì cờ trùng tên sẽ ĐÈ nhau trong `select`. ⟲ S10-SEC-AUDITLOGROW-1 (KI-070) — ĐỌC KỸ CHỖ NÀY TRƯỚC KHI 'SỬA CHO NHẤT QUÁN': vị từ HÀNG mới bám CHỦ THỂ (`user_security_events.user_id`), CỐ Ý **không** `OR actor_user_id`, nên hàng mà tôi là người gây ra KHÔNG lọt vào tập hàng của tôi ở scope `Own` — cột này vì thế chỉ còn nói về actor của những hàng VỀ tôi. Nới vế actor để 'thấy việc mình đã làm' biến tập hàng thành hàm của LỊCH SỬ HÀNH VI, không luật nào kiểm được. Đây là BA vị từ trên BA bảng, không phải một vị từ dùng ba lần.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:actor.fullName",
    basis: "identity-gated",
    reason:
      "KI-054 — cùng nhóm NGƯỜI GÂY RA, cùng grant riêng và cùng cờ `actorIdentityInScope`. ⟲ S10-SEC-AUDITLOGROW-1: cùng ranh giới D7 với cột email ở dòng trên — tập hàng bám chủ thể, không bám người gây ra.",
    signedBy: WO,
  },
  {
    point: "leave/leave-admin.repository.ts#listBalancesTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-069 — leave-admin.service.ts:511-560 gọi `resolveAndAssert('view','leave-balance')` rồi VỨT giá trị scope: gate đúng, tập hàng vẫn toàn công ty. Nay có grant riêng cho cặp danh bạ + ORDER BY đổi sang cột đã che (che tên mà vẫn sắp theo tên gốc thì thứ tự hàng rò alphabet).",
    signedBy: WO,
  },
  // ── assets (S11-ASSET-BE-1) ──────────────────────────────────────────────────
  {
    point: "assets/assets.repository.ts#holderSelect:users.fullName",
    basis: "scoped-predicate",
    reason:
      "asset-access.service.ts#resolveActorScope — resolveAndAssert(view,asset) rồi dựng holderVisibleCond (Own = users.id = actor · Department = employee_profiles.org_unit_id IN đơn vị ∪ đơn vị làm trưởng · Company = true); holderGrant bọc users.full_name của NGƯỜI ĐANG GIỮ (lượt Active) ở cả chi tiết 007 lẫn danh sách 005 (holderSelect dùng chung). Cờ holderVisible quyết định mapper BỎ HẲN khoá currentHolder (SPEC-13 §13.6). Tập HÀNG bound bởi readScopeExists (EXISTS asset_assignments, không JOIN). Bằng chứng: test/integration/asset-be1-scope.int-spec.ts.",
    signedBy: "S11-ASSET-BE-1",
  },
  {
    point: "assets/asset-assignments.repository.ts#listByAssetTx:users.fullName",
    basis: "scoped-predicate",
    reason:
      "Lịch sử cấp phát 012: cùng holderVisibleCond của actor vừa LỌC HÀNG (rowScope: Own = employee_profiles.user_id = actor · Department = org_unit_id IN đơn vị) vừa bọc users.full_name của người nhận trong từng hàng — hàng ngoài scope không tới được lời chiếu (SPEC-13 §13.6, API-14 §6.4). Bằng chứng: test/integration/asset-be1-scope.int-spec.ts.",
    signedBy: "S11-ASSET-BE-1",
  },
  {
    point: "assets/asset-access.service.ts#findUserDisplayNameTx:users.fullName",
    basis: "self-bound-row",
    reason:
      "Tên của CHÍNH actor cho payload NOTI (actor_name): selfBound(userId, users.id) + WHERE users.id = actor AND company_id — hàng chỉ có thể là chính chủ. Thay cho raw SQL (không nới vùng mù rawSqlIdentity).",
    signedBy: "S11-ASSET-BE-1",
  },
  // ── rooms (S11-ROOM-BE-1) ────────────────────────────────────────────────────
  {
    point: "rooms/room-people.repository.ts#namesByUserIdsTx:users.fullName",
    basis: "identity-gated",
    reason:
      "ĐIỂM CHIẾU DUY NHẤT của module ROOM (organizer · bookedBy · attendees · cancelledBy · conflicts[].organizerName · organizer_name/actor_name NOTI). Cặp GATE của route ghi (`book`/`cancel`) KHÁC cặp BOUND: vị từ = room-access.service.ts#peopleVisibleCond suy từ resolveOrNull('view','room') — Company/System ⇒ true (SPEC-14 §11: view@Company mọi role seed, lịch là dữ liệu dùng chung), hẹp hơn/không có cặp ⇒ users.id = actor (fail-closed). Tập HÀNG là lượt đặt (không phải users) — bound bởi company_id + withTenant; cột tên bọc bởi identityColumns trên users (không alias), employeeCode bọc CÙNG vị từ, WHERE users.company_id AND deleted_at IS NULL. Đường đọc (resolveViewActor) TỪ CHỐI 403 khi view hẹp hơn Company. Bằng chứng: test/integration/room-be1-scope.int-spec.ts §H (tên + mã hiện cho employee view@Company; role `bn` chỉ book/cancel KHÔNG view ⇒ POST 201 với organizer = chính mình có tên, attendees[].displayName/employeeCode = null, conflicts[].organizerName = null; role view@Own ⇒ 403 AUTH-ERR-SCOPE-DENIED).",
    signedBy: "S11-ROOM-BE-1",
  },
  // ── recruit (S12-RECRUIT-BE-1) ───────────────────────────────────────────────
  {
    point: "recruit/recruit-people.repository.ts#namesByUserIdsTx:users.fullName",
    basis: "identity-gated",
    reason:
      "ĐIỂM CHIẾU DUY NHẤT của module RECRUIT (recruiter phụ trách · interviewer/participant · picker 031/032 — SPEC-12 §18, khuôn ROOM). Vị từ = RecruitActor.peopleVisibleCond, tính ĐÚNG MỘT LẦN/request bởi recruit-access.service.ts#resolveActor theo cặp CỦA ROUTE lấy từ bảng hằng RECRUIT_ROUTE_PAIRS (recruit-route-pairs.const.ts — CÙNG bảng cho decorator + assert tầng 2 + căn cứ chiếu; repository KHÔNG nhận cặp rời ⇒ không có đường truyền cặp sai route, plan-review vòng 2 #3). Company/System ⇒ true (job-opening/candidate/offer CHỈ Company theo §13.6 — mọi grant thật đều mở tên); scope hẹp hơn/không grant ⇒ users.id = actor (fail-closed). employeeCode bọc CÙNG vị từ (mirror ROOM M2). Hai picker tái dùng CHÍNH hàm này (lọc q SAU khi bọc cột — không SELECT users trần). Bằng chứng: test/foundation/recruit-two-layer-guard-census.unit-spec.ts (32 route × cặp, 2 tầng so với CÙNG bảng hằng) + test/integration/recruit-be1-scope.int-spec.ts (ma trận per-pair + masking).",
    signedBy: "S12-RECRUIT-BE-1",
  },
];

/**
 * TRẦN ĐẾM cho **MỌI** căn cứ.
 *
 * ⚠️ ĐÍNH CHÍNH (security-reviewer 2026-08-19, F5): bản đầu chỉ đặt trần cho bốn căn cứ "không đo
 * được bằng máy", với lý lẽ "ba căn cứ còn lại mang vị từ SQL thật nên tự nó là bằng chứng". Lý lẽ đó
 * **sai ở tầng sổ này**: sổ chỉ chứa CHUỖI, ratchet không bao giờ nhìn thấy vị từ. Hệ quả là đường né
 * rẻ nhất vẫn mở toang — một điểm chiếu MỚI không bound chỉ cần một dòng `basis:"scoped-predicate"`
 * (21 dòng, không trần, không kiểm) hoặc `basis:"order-only"` (một lời khai thuần tuý) là ratchet
 * XANH.
 *
 * Nay MỌI basis có trần. Thêm một điểm chiếu ⇒ ĐỎ ⇒ người thêm phải sửa con số ở đây, tức một thao
 * tác CÓ CHỦ ĐÍCH đi qua FULL gate. Đó chính là thứ ratchet dùng để đổi lấy sự bất tiện.
 */
export const BASIS_CEILINGS: Readonly<Record<string, number>> = {
  // Không đo được bằng máy — chúng là câu người viết.
  waiver: 7,
  "no-actor": 7,
  "second-assert": 3,
  // 7 → 8 (S10-SEC-LOGINLOG429-1, 25/08/2026): `recordLoginAttemptForUser:users.email`. Nới CÓ CHỦ
  // ĐÍCH và đi qua FULL gate đúng như dòng cảnh báo của cổng này đòi. Điểm mới KHÔNG mở bề mặt đọc
  // nào: email đọc ra chỉ rơi vào `login_logs.email` (cột vốn đã chứa email client tự khai), và bề
  // mặt đọc lại của cột đó gác danh tính riêng qua `LoginLogGrants.identity`.
  "self-bound-route": 8,
  "order-only": 1,
  // Có vị từ SQL thật, nhưng SỔ này không nhìn thấy vị từ ⇒ vẫn phải có trần.
  "scoped-predicate": 23, // S11-ASSET-BE-1: +2 (holderSelect · listByAssetTx) — plan-review B7, nâng có chủ đích qua FULL gate
  membership: 8,
  "self-bound-row": 4, // S11-ASSET-BE-1: +1 (findUserDisplayNameTx — tên actor cho payload NOTI, thay raw SQL để không nới vùng mù rawSqlIdentity)
  // 14 → 15 (S11-ROOM-BE-1, 30/08/2026): `rooms/room-people.repository.ts#namesByUserIdsTx` — điểm chiếu DUY NHẤT của
  // module ROOM; cặp gate route ghi (`book`/`cancel`) ≠ cặp bound (`view`, resolveOrNull ⇒ fail-closed `users.id =
  // actor`). Nới có chủ đích, plan-review B1 chọn basis này thay vì nâng `scoped-predicate` (đã bão hoà); qua FULL gate.
  // 15 → 16 (S12-RECRUIT-BE-1, 31/08/2026): `recruit/recruit-people.repository.ts#namesByUserIdsTx` — điểm
  // chiếu DUY NHẤT của module RECRUIT; cond thật từ resolveOrNull theo cặp của route (bảng hằng
  // RECRUIT_ROUTE_PAIRS), fail-closed users.id=actor. Nới có chủ đích, plan-review 2 vòng + FULL gate.
  "identity-gated": 16,
};

/**
 * VÙNG MÙ ĐÃ PIN — ba đường mà census tĩnh KHÔNG thấy (xem `blindSpots()`).
 *
 * Pin thành SỐ chứ không để ở dạng văn xuôi: một giới hạn viết bằng lời thì phiên sau không đo được
 * nó có nới ra hay không. Tăng ⇒ ĐỎ ⇒ người thêm phải nói ra mình đang mở rộng vùng mù.
 *
 * `asIdentityGrant: 0` là chiều bịt lỗ mà tầng type KHÔNG bịt được — brand `unique symbol` chặn object
 * literal thuần nhưng không chặn toán tử ép kiểu.
 */
export const BLIND_SPOT_PINS = {
  /** `.select()` trần trên bảng `users` — đo 2026-08-19. */
  bareSelect: 6,
  /**
   * Template `sql` ghép `email`/`full_name` bằng chuỗi thô — đo 2026-08-19.
   * 13 → 14 (S12-RECRUIT-DB-1, 31/08/2026): `db/schema/recruit.ts` — expression index
   * `lower(${t.email})` trên `candidates.email` (idx_candidates_company_email_expr, RECRUIT-API-008
   * check-duplicate). Đây là DDL trên cột email CỦA ỨNG VIÊN, không phải chiếu danh tính `users`;
   * drizzle bắt buộc dùng `sql` cho expression index nên không có đường viết khác. Vế partial-WHERE
   * đi qua `isNotNull()` để không tốn thêm một đếm. Nới có chủ đích, ký qua gate của WO DB-1.
   */
  /**
   * 14 → 15 (S12-RECRUIT-BE-1, 31/08/2026): `recruit/candidates.repository.ts#findDuplicatesTx` —
   * `lower(${candidates.email}) = lower(${email})`: biểu thức check-duplicate PHẢI mirror ĐÚNG
   * biểu thức của index `idx_candidates_company_email_expr` (RECRUIT-API-008); cột email CỦA ỨNG
   * VIÊN (bảng candidates), không phải chiếu danh tính `users` — cùng lớp với bump 13→14 của DB-1.
   * Response check-duplicate KHÔNG trả email/phone (chỉ id/fullName/stage/jobTitle/deleted).
   */
  rawSqlIdentity: 15,
  /** Ép kiểu TƯỜNG MINH sang `IdentityGrant` ngoài điểm đúc — phải LUÔN bằng 0. */
  asIdentityGrant: 0,
  /** File export `alias(users,…)` — mỗi cái là một đường mà scanner một-file không lần được (F12). */
  exportedUserAliases: 1,
} as const;

/**
 * S10-SEC-AUDITLOGROW-1 (KI-070) — ĐIỂM ĐÚC vị từ chặn TẬP HÀNG, pin thành DANH SÁCH chứ không thành
 * số đếm (xem `rowScopePredicateMints()`).
 *
 * Vì sao là danh sách: một trần dạng `<= n` cho phép ĐỔI CHỖ trong im lặng — gỡ điểm đúc ở
 * `auth-logs-viewer` và thêm một điểm ở module khác thì số không đổi, trong khi bề mặt đã đổi hoàn
 * toàn. Danh sách bắt cả hai chiều (thêm MỚI và mất CŨ), đúng khuôn "chiều 2" của sổ phán quyết.
 *
 * Vì sao pin bề mặt này chứ không để nó tự do: `rowScopeSql()` chỉ gác đường TIÊU THỤ. Một grant
 * `scoped-predicate` đúc ở nơi mới rồi AND thẳng vào `WHERE` **không qua cổng** là hợp kiểu và im
 * lặng. Thêm một điểm đúc = mở một bề mặt bound-HÀNG mới ⇒ phải đi qua FULL gate và ký lại ở đây,
 * kèm int-spec deny/allow của CHÍNH bảng đó (assert BẢNG trong `rowScopeSql` không bắt được ca "cả
 * nơi đúc lẫn nơi tiêu thụ cùng trỏ sai một bảng").
 *
 * Đo 2026-08-21: ĐÚNG MỘT điểm — hai route nhật ký dùng chung `rowScopeFor()`.
 * Đo 2026-08-22 (S10-SEC-AUDITLOGROW-2 / KI-072): HAI điểm — thêm bề mặt `audit_logs`.
 * Đo 2026-08-22 (S10-SEC-ROLEMEMBERROW-1 / KI-071): BA điểm — thêm bề mặt `user_roles ⋈ users`.
 *
 * ⚠️ Điểm thứ hai CỐ Ý là một bản sao gần giống điểm thứ nhất, KHÔNG phải một helper dùng chung
 * (plan D7): gộp hai bề mặt vào một lời gọi `fromScope` làm census chỉ thấy MỘT điểm ⇒ việc
 * `audit_logs` được bound trở nên VÔ HÌNH với chính cái ratchet dựng ra để bắt "mở rộng bề mặt mà
 * không ký".
 *
 * ⟲ S10-SEC-ROLEMEMBERROW-1 (KI-071) — điều kiện gộp đã ĐĂNG KÝ TRƯỚC ở dòng này ("khi KI-071 thêm
 * điểm THỨ BA thì đó mới là lúc cân nhắc lại, ở một WO riêng") NAY ĐÃ THOẢ: có BA bản sao gần giống
 * nhau. WO KI-071 CỐ Ý không gộp — gộp là refactor CROWN chạm hai đường đã nghiệm thu, và nó phải
 * giải bài toán "gộp mà ratchet vẫn thấy TỪNG bề mặt" TRƯỚC khi gộp. Đây là **nợ CÓ TÊN**, chờ WO
 * riêng; đừng gộp nhân tiện trong một WO khác.
 */
export const ROW_SCOPE_MINT_PINS = [
  /** `login_logs` + `user_security_events` — S10-SEC-AUDITLOGROW-1 (KI-070). */
  "auth/auth-logs-viewer.service.ts#rowScopeFor",
  /**
   * `audit_logs`, đường COMPANY (`GET /foundation/audit-logs` + `/:id`) — S10-SEC-AUDITLOGROW-2
   * (KI-072). Bằng chứng deny/allow của CHÍNH bảng này:
   * `test/foundation/foundation-audit-row-scope.int-spec.ts` (R1·R2·R3·N1·T1 / A1-A4·C1·C2·G1).
   */
  "foundation/audit/audit.service.ts#rowScopeFor",
  /**
   * `user_roles` ⋈ `users` (`GET /auth/roles/:id/members`) — S10-SEC-ROLEMEMBERROW-1 (KI-071).
   * Bằng chứng deny/allow của CHÍNH bảng này: `test/integration/identity-projection-scope.int-spec.ts`
   * (A2·A3·R-D2·R-D3·R-T1·R-T2·R-G1·R-X1 / A1·R-A3) + tầng KHÔNG-cần-DB
   * `src/permission/role-admin.row-scope.spec.ts` (U1·U1b·U1c·U2·U3·U4).
   *
   * ⚠️ ĐIỂM KHÁC BIỆT với hai điểm trên, phải đọc trước khi so sánh: ở đây cặp bound TRÙNG cặp gate
   * VÀ trùng luôn cặp cột của tầng CỘT ⇒ tầng cột của route này bị BAO TRÙM (xem hai dòng verdict
   * `listRoleMembersTx:*`). Cú ném 403 fail-closed nằm ở `listMembersInner` (nơi resolve), KHÔNG nằm
   * trong `rowScopeFor` — vì luật "phân giải mỗi cặp ĐÚNG MỘT LẦN/request" đòi một lời gọi duy nhất
   * nuôi cả hai tầng.
   */
  "permission/role-admin.service.ts#rowScopeFor",
  /**
   * `assets` ⋈ `asset_assignments` ⋈ `employee_profiles` ⋈ `users` (chi tiết 007 + danh sách 005) —
   * S11-ASSET-BE-1. Vị từ = holderVisibleCond của actor (Own: chính chủ · Department: đơn vị ∪ đơn vị làm
   * trưởng · Company: true) — bọc CỘT tên người giữ; tập HÀNG bound riêng bởi readScopeExists (EXISTS).
   * Bằng chứng deny/allow của CHÍNH bảng này: `test/integration/asset-be1-scope.int-spec.ts`.
   */
  "assets/assets.repository.ts#holderGrant",
  /**
   * `asset_assignments` ⋈ `employee_profiles` ⋈ `users` (lịch sử cấp phát 012) — S11-ASSET-BE-1. Cùng
   * vị từ với điểm trên nhưng ở đây nó LỌC HÀNG (rowScope) VÀ bọc cột trong cùng một hàm. Bằng chứng:
   * `test/integration/asset-be1-scope.int-spec.ts`.
   */
  "assets/asset-assignments.repository.ts#listByAssetTx",
] as const;

/**
 * S10-SEC-AUDITLOGROW-2 (KI-072) — hộ TIÊU THỤ họ `*UnscopedTx` của `AuditRepository` (đường đọc
 * `audit_logs` KHÔNG bound hàng). Xem `unscopedAuditConsumers()` cho lý do bộ đếm này tồn tại tách
 * khỏi `ROW_SCOPE_MINT_PINS`: hàm kia đếm điểm ĐÚC vị từ, chiều TIÊU THỤ SAI nó không thấy.
 *
 * Khoá là `file#<số lời gọi>` — pin theo FILE trần (bản đầu) hụt đúng chỗ nguy hiểm nhất: ba file
 * dưới ĐÃ được ký, nên một đường đọc COMPANY mới viết NGAY TRONG chúng sẽ cho ratchet XANH. Đổi số
 * lời gọi là ĐỎ, kể cả trong file đã ký.
 *
 * Bốn mục, mỗi mục một lý do KHÁC NHAU — thêm mục thứ năm phải nói ra mình thuộc lý do nào:
 */
export const UNSCOPED_AUDIT_CONSUMER_PINS = [
  /** ATT viewer: cặp quyền RIÊNG `view:attendance-audit-log` + allowlist `objectTypes` của module. */
  "attendance/attendance-audit.service.ts#2",
  /** Nơi ĐỊNH NGHĨA họ phương thức — không phải hộ tiêu thụ, nhưng chuỗi có mặt trong file. */
  "foundation/audit/audit.repository.ts#3",
  /** Đường operator `/all` (+ `/all/:id`): cặp `view:platform-audit`, chéo tenant CÓ CHỦ Ý (mig 0340). */
  "foundation/audit/audit.service.ts#3",
  /** LEAVE viewer: cặp quyền RIÊNG `view:leave-audit-log` + allowlist `objectTypes` của module. */
  "leave/leave-audit.service.ts#2",
] as const;

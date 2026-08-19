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
    reason: "Job cảnh báo chấm công (scheduler) — không có actor HTTP nào để resolve scope. Tên đi vào payload NOTI của chính người bị cảnh báo.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance-alert-noti.repository.ts#fetchMissingCheckoutRowsTx:users.fullName",
    basis: "no-actor",
    reason: "Job quét thiếu check-out (scheduler, attendance-alert-noti.repository.ts:193) — không có actor HTTP để resolve scope. Tên đi vào payload NOTI gửi cho chính người bị nhắc.",
    signedBy: WO,
  },
  {
    point: "attendance/attendance-alert-noti.repository.ts#materializeAbsentCandidatesTx:users.fullName",
    basis: "no-actor",
    reason: "Job dựng danh sách vắng (attendance-alert-noti.repository.ts:282) — không có actor HTTP. Tên đi vào payload NOTI của chính người vắng, không phải một danh bạ trả cho ai đọc.",
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
    reason: "attendance-report.service.ts:40-62 — resolveAndAssert(isSensitive) + buildEmployeeScopeCondition, `scopeCond` là tham số BẮT BUỘC của listReportTx.",
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
    reason: "remote-work-request.service.ts:288-298 — resolveAndAssert + buildEmployeeScopeCondition; luồng 'của tôi' dùng `ownScopeCond` (:256).",
    signedBy: WO,
  },

  // ── auth (self) ─────────────────────────────────────────────────────────────
  {
    point: "auth/auth.service.ts#completeTwoFactorLogin:users.email",
    basis: "self-bound-route",
    reason: "auth.service.ts:503 `eq(users.id, claims.sub)` — bước 2 của đăng nhập, chủ thể là chính người đang đăng nhập. Không có đường truyền id của người khác.",
    signedBy: WO,
  },
  {
    point: "auth/auth.service.ts#me:users.email",
    basis: "self-bound-route",
    reason: "auth.service.ts:1096-1110 bootstrap `/auth/me` — `eq(users.id, claims.sub)` từ token, không nhận tham số.",
    signedBy: WO,
  },
  {
    point: "auth/auth.service.ts#me:users.fullName",
    basis: "self-bound-route",
    reason: "auth.service.ts:1105 — cùng truy vấn bootstrap `/auth/me` với cột email ở dòng trên: `eq(users.id, claims.sub)` lấy từ token, route không nhận tham số id nào.",
    signedBy: WO,
  },
  {
    point: "auth/two-factor.service.ts#enroll:users.email",
    basis: "self-bound-route",
    reason: "two-factor.service.ts:166 `eq(users.id, userId)` với `userId` = actor đang enroll TOTP cho chính mình. Email dùng dựng nhãn otpauth.",
    signedBy: WO,
  },

  // ── chat ────────────────────────────────────────────────────────────────────
  {
    point: "chat/chat-attachments.repository.ts#listRoomFiles:users.fullName",
    basis: "membership",
    reason: "chat-attachments.service.ts:158 — `assertMember` TRƯỚC mọi thứ (404 chung). Người ngoài phòng không chạm được hàng nào.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#findSenderDisplayName:users.email",
    basis: "self-bound-row",
    reason: "chat-messages.service.ts:277 truyền `actor.id` — lấy tên hiển thị của CHÍNH người gửi để dựng payload NOTI.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#findSenderDisplayName:users.fullName",
    basis: "self-bound-row",
    reason: "chat-messages.repository.ts:518 — cùng truy vấn với cột email: chat-messages.service.ts:277 truyền `actor.id`, lấy tên hiển thị của CHÍNH người gửi để dựng payload NOTI.",
    signedBy: WO,
  },
  {
    point: "chat/chat-messages.repository.ts#MESSAGE_COLUMNS:users.fullName",
    basis: "membership",
    reason: "Mọi đường đọc tin đi qua `ChatAccessService.assertMember`/`assertMessageAccess` (chat-access.service.ts:122,235) — điểm khẳng định membership DUY NHẤT của module.",
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
    reason: "Như trên — nhật ký ai đã dùng quyền giám sát; tên người giám sát là nội dung của chính bản ghi.",
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
    reason: "chat-rooms.service.ts:138 + chat-members.service.ts:341 — cả hai sau `assertMember` (đường thứ hai là đọc-lại-sau-ghi, thao tác ghi đã gate).",
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
    reason: "employees.service.ts:130-150 — resolveAndAssert rồi `isEmployeeInScope` cho hàng đơn; list đi qua :95-108 với `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#DETAIL_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason: "Cùng bản đồ cột DETAIL_COLUMNS với cột email: employees.service.ts:130-150 resolveAndAssert rồi `isEmployeeInScope` cho hàng đơn — hồ sơ ngoài scope không tới được lời chiếu.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#LIST_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason: "employees.service.ts:95-108 — resolveAndAssert + buildEmployeeScopeCondition; `listEmployeesTx` nhận `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/employees.repository.ts#LIST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason: "Cùng bản đồ cột LIST_COLUMNS với cột email: employees.service.ts:95-108 resolveAndAssert + buildEmployeeScopeCondition, `listEmployeesTx` nhận `scopeCond`.",
    signedBy: WO,
  },
  {
    point: "employees/hr-org-chart.repository.ts#listScopedActiveTx:users.fullName",
    basis: "scoped-predicate",
    reason: "hr-org-chart.service.ts:47-58 — resolveAndAssert + buildEmployeeScopeCondition, `scopeCond` là tham số BẮT BUỘC.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:directManagerUsers.fullName",
    basis: "scoped-predicate",
    reason: "alias(users,'direct_manager_users') — tên quản lý trực tiếp của CHÍNH hồ sơ đã lọc theo scope (hr-read.service.ts:186 resolveAndAssert). Đường quan hệ, không phải danh bạ độc lập.",
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
    reason: "hr-read.service.ts:186 — resolveAndAssert trước khi đọc chi tiết; hàng ngoài scope không tới được.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#DETAIL_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason: "Cùng bản đồ cột DETAIL_COLUMNS với cột email: hr-read.service.ts:186 resolveAndAssert trước khi đọc chi tiết; hàng ngoài scope không tới được.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#LIST_COLUMNS:users.email",
    basis: "scoped-predicate",
    reason: "hr-read.service.ts:93-104 — resolveAndAssert + buildEmployeeScopeCondition; `listScopedTx(tx, companyId, scopeCond, …)`.",
    signedBy: WO,
  },
  {
    point: "employees/hr-read.repository.ts#LIST_COLUMNS:users.fullName",
    basis: "scoped-predicate",
    reason: "Cùng bản đồ cột LIST_COLUMNS với cột email: hr-read.service.ts:93-104 resolveAndAssert + buildEmployeeScopeCondition, `listScopedTx` nhận `scopeCond`.",
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
    reason: "Producer outbox đồng bộ tài khoản sang LMS — chạy trong tx nghiệp vụ, không có actor HTTP. Đích đến là hệ LMS nội bộ đã ký SSO.",
    signedBy: WO,
  },
  {
    point: "integrations/lms/lms-sync-producer.service.ts#enqueueSync:users.fullName",
    basis: "no-actor",
    reason: "Cùng truy vấn producer outbox với cột email (lms-sync-producer.service.ts:49) — chạy trong tx nghiệp vụ, không actor HTTP; đích là hệ LMS nội bộ đã ký SSO.",
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
    reason: "Cùng truy vấn job handler với cột email (lms-user-sync.job-handler.ts:96) — chạy ở worker, không actor HTTP.",
    signedBy: WO,
  },

  // ── leave ───────────────────────────────────────────────────────────────────
  {
    point: "leave/leave-approval.repository.ts#listPendingScopedTx:users.fullName",
    basis: "scoped-predicate",
    reason: "leave-approval.service.ts:104-116 — `scopeCond` là tham số BẮT BUỘC của cả `countPendingScopedTx` lẫn `listPendingScopedTx`.",
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
    reason: "leave-report.service.ts:34-46 — resolveAndAssert('export', leave, isSensitive) + buildEmployeeScopeCondition; kèm audit-on-read trong cùng tx.",
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
    reason: "leave.service.ts:163-182 — `scope=all` phải qua `assertCan('approve','leave')`; vai `employee` KHÔNG có cặp này.",
    signedBy: WO,
  },

  // ── me (self) ───────────────────────────────────────────────────────────────
  {
    point: "me/me.repository.ts#findAccountByUserIdTx:users.email",
    basis: "self-bound-route",
    reason: "me.repository.ts:78-85 `eq(users.id, userId)` với userId resolve từ token. `/me/*` theo định nghĩa chỉ phục vụ chính chủ.",
    signedBy: WO,
  },
  {
    point: "me/me.repository.ts#findAccountByUserIdTx:users.fullName",
    basis: "self-bound-route",
    reason: "me.repository.ts:80 — cùng truy vấn với cột email: `eq(users.id, userId)` token-resolved, `/me/*` theo định nghĩa chỉ phục vụ chính chủ.",
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
    reason: "org.repository.ts:360 — `scopeCond: SQL` BẮT BUỘC, không giá trị mặc định (S6-SEC-ORGSCOPE-1/N-1: optional ở đây nghĩa là quên truyền thì lặng lẽ quay về hành vi rò cũ).",
    signedBy: "S6-SEC-ORGSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listEmployees:users.fullName",
    basis: "scoped-predicate",
    reason: "org.repository.ts:366 — cùng truy vấn với cột email: `scopeCond: SQL` là tham số BẮT BUỘC, không có giá trị mặc định (N-1).",
    signedBy: "S6-SEC-ORGSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeamMembers:users.email",
    basis: "identity-gated",
    reason: "org.repository.ts:285-291 — `case when (showIdentity)` với vị từ của cặp danh bạ `view:user`; org.service.ts:260-262 bỏ HẲN khoá khi ngoài scope (N-1c, KI-049).",
    signedBy: "S6-SEC-ORGTEAMSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeamMembers:users.fullName",
    basis: "identity-gated",
    reason: "org.repository.ts:288 — cùng cụm `case when (showIdentity)` với cột email; org.service.ts:260-262 bỏ HẲN khoá khi ngoài scope vì contract khai `.optional()` (N-1c, KI-049).",
    signedBy: "S6-SEC-ORGTEAMSCOPE-1",
  },
  {
    point: "org/org.repository.ts#listTeams:users.fullName",
    basis: "identity-gated",
    reason: "org.repository.ts:183-186 `leaderUserName` — N-1e/KI-052. `null` KHÔNG dùng để mang tin (contract nullable hợp lệ vì team có thể chưa có trưởng nhóm) nên phải bỏ khoá qua `identityInScope`.",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },

  // ── recycle-bin ─────────────────────────────────────────────────────────────
  {
    point: "recycle-bin/recycle-bin.repository.ts#deletedColumns:users.email",
    basis: "identity-gated",
    reason: "recycle-bin.repository.ts:22-27 — `case when (showIdentity)`; `identityCond` là tham số BẮT BUỘC, `null` ⇒ `false` (N-1d, KI-051).",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },
  {
    point: "recycle-bin/recycle-bin.repository.ts#deletedColumns:users.fullName",
    basis: "identity-gated",
    reason: "recycle-bin.repository.ts:25 — cùng cụm `case when (showIdentity)` với cột email; `identityCond` BẮT BUỘC, `null` ⇒ `false` fail-closed (N-1d, KI-051).",
    signedBy: "S6-SEC-IDENTITYBOUND-1",
  },

  // ── tasks ───────────────────────────────────────────────────────────────────
  {
    point: "tasks/projects.repository.ts#findDetailByIdTx:ownerUser.fullName",
    basis: "membership",
    reason: "projects.service.ts:148,164,181 truyền `scopeExists` — vị từ tồn-tại-thành-viên của dự án. Đường đọc-lại-sau-ghi (:1005) đi sau thao tác ghi đã gate.",
    signedBy: WO,
  },
  {
    point: "tasks/projects.repository.ts#listMembersTx:memberUser.fullName",
    basis: "membership",
    reason: "projects.service.ts:166 — gọi SAU `findDetailByIdTx(tx, …, scopeExists)`; không truy cập được dự án thì không tới được danh sách thành viên.",
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
      "KI-053 — role-admin.service.ts:113-140: `assertCan(view,user)` chỉ trả lời CÓ/KHÔNG, không đọc data_scope. Nay `resolveOrNull` + `buildUserScopeConditionOn(users)` dựng vị từ, `identityColumns` khử ở SQL, service BỎ HẲN khoá (contract `.optional()`). ORDER BY cũng đổi sang cột đã che để thứ tự không rò alphabet.",
    signedBy: WO,
  },
  {
    point: "permission/role-admin.repository.ts#listRoleMembersTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-053 — cùng cụm `case when` với cột email; `fullName` cũng bị BỎ KHOÁ (không giữ `null`) vì `null` đã mang nghĩa 'user chưa đặt họ tên'.",
    signedBy: WO,
  },
  {
    point: "auth/login-log.repository.ts#findManyTx:users.email",
    basis: "identity-gated",
    reason:
      "KI-054 — auth-logs-viewer.service.ts `identityGrantFor()`: cặp GATE là `view:audit-log`, cặp BOUND là `view:user` ⇒ `resolveOrNull` (khuôn N-1c). Trước bản vá docstring ghi 'Company-scope' nhưng không có gì resolve data_scope.",
    signedBy: WO,
  },
  {
    point: "auth/login-log.repository.ts#findManyTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-054 — cùng cụm `case when` với cột email; `userRef()` ba nhánh phân biệt 'không gắn user' / 'ngoài scope' / 'user đã xoá'.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:users.email",
    basis: "identity-gated",
    reason:
      "KI-054 — nhóm CHỦ THỂ, vị từ dựng trên `users.id`/`users.company_id`, cờ `identityInScope`.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:users.fullName",
    basis: "identity-gated",
    reason: "KI-054 — cùng nhóm CHỦ THỂ, cùng cụm `case when`, cùng cờ `identityInScope`.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:actor.email",
    basis: "identity-gated",
    reason:
      "KI-054 — nhóm NGƯỜI GÂY RA, GRANT RIÊNG dựng trên `SECURITY_EVENT_ACTOR.id`/`.company_id`. Tái dùng vị từ của chủ thể vừa lộ actorEmail của người khác (hàng có chủ thể = tôi) vừa giấu email của chính tôi (hàng tôi là actor) — hai chiều đều sai. Cờ riêng `actorIdentityInScope` vì cờ trùng tên sẽ ĐÈ nhau trong `select`.",
    signedBy: WO,
  },
  {
    point: "auth/security-event.repository.ts#findManyTx:actor.fullName",
    basis: "identity-gated",
    reason:
      "KI-054 — cùng nhóm NGƯỜI GÂY RA, cùng grant riêng và cùng cờ `actorIdentityInScope`.",
    signedBy: WO,
  },
  {
    point: "leave/leave-admin.repository.ts#listBalancesTx:users.fullName",
    basis: "identity-gated",
    reason:
      "KI-069 — leave-admin.service.ts:511-560 gọi `resolveAndAssert('view','leave-balance')` rồi VỨT giá trị scope: gate đúng, tập hàng vẫn toàn công ty. Nay có grant riêng cho cặp danh bạ + ORDER BY đổi sang cột đã che (che tên mà vẫn sắp theo tên gốc thì thứ tự hàng rò alphabet).",
    signedBy: WO,
  },
];

/**
 * TRẦN ĐẾM cho bốn căn cứ KHÔNG đo được bằng máy.
 *
 * Vì sao cần: `waiver` / `no-actor` / `second-assert` / `self-bound-route` đều không mang vị từ SQL nào
 * để kiểm — chúng là câu người viết. Không có trần thì đường né rẻ nhất là dán một trong bốn nhãn ấy
 * lên điểm mới, và ratchet vẫn xanh. Có trần thì thêm một điểm là ĐỎ, và người thêm phải sửa con số ở
 * đây — một thao tác CÓ CHỦ ĐÍCH, đi qua FULL gate.
 *
 * Ba căn cứ còn lại (`scoped-predicate` · `identity-gated` · `self-bound-row` · `membership`) mang vị
 * từ thật nên không cần trần — siết chúng chỉ làm khó việc vá đúng.
 */
export const BASIS_CEILINGS: Readonly<Record<string, number>> = {
  waiver: 7,
  "no-actor": 7,
  "second-assert": 3,
  "self-bound-route": 7,
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
  /** Template `sql` ghép `email`/`full_name` bằng chuỗi thô — đo 2026-08-19. */
  rawSqlIdentity: 13,
  /** Ép kiểu sang `IdentityGrant` — phải LUÔN bằng 0. */
  asIdentityGrant: 0,
} as const;

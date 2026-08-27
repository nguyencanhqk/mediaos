/**
 * S10-FND-PARAMUUID-2 (KI-078) — SỔ PHÁN QUYẾT cho **NHÓM ĐỢT-1** của kênh PARAM.
 *
 * ─── MỨC ĐỘ (phát biểu TRƯỚC mọi số đo — đừng để người đọc tự suy) ──────────────────────────────
 * Lớp hỏng mà sổ này ghi lại hỏng **ĐÚNG CHIỀU AN TOÀN**: chuỗi rác ở `:id` làm request bị TỪ CHỐI
 * (500 thay vì 400) — KHÔNG hàng nào rò, KHÔNG quyền nào bị vượt, KHÔNG ghi được gì. ⇒ **KHÔNG phải
 * lỗ bảo mật.** Giá trị của bản vá là (a) hợp đồng API — client nhận 400 có mã thay vì 500 vô nghĩa;
 * (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu 500 THẬT. Y hệt
 * KI-068 (kênh BODY) và KI-077 (kênh PARAM của `foundation/files`).
 *
 * ─── PHẠM VI: 32 THAM SỐ, KHÔNG PHẢI 221 ───────────────────────────────────────────────────────
 * Sổ này CỐ Ý **chỉ** phủ nhóm đợt-1 (32 tham số / 7 controller). Nó KHÔNG phải ledger của cả 221
 * tham số unpiped đo được ngày 25–26/08/2026: dựng ledger 221 dòng mà 189 dòng trong đó chưa ai đo
 * bằng HTTP là đúng thứ `done_when` của WO cấm ("đừng ép số cho khớp mô tả").
 *
 * TIÊU CHÍ CHỌN NHÓM: *workflow phê duyệt (FSM nghỉ phép / điều chỉnh công) · module nhạy cảm
 * SPEC-04 + SPEC-05 · route GHI*. Phân bố: leave 15 · attendance-adjustment 4 · remote-work 5 ·
 * attendance 3 · attendance-shift 2 · approval-inbox 2 · auth-session 1 = **32** (14,5% của 221).
 *
 * ─── VÌ SAO CẦN SỔ, KHÔNG CHỈ CẦN CON SỐ ───────────────────────────────────────────────────────
 * `UNPIPED_CEILING` một mình chỉ chặn "nhiều hơn", KHÔNG chặn "đổi chỗ này lấy chỗ kia": gỡ một pipe
 * ở `leave` rồi thêm một pipe ở `tasks` thì tổng vẫn bằng trần và ratchet vẫn xanh. Sổ này khoá theo
 * **TỪNG SITE** nên cú đánh đổi đó ĐỎ ngay (ca (5) của `param-uuid-ratchet.unit-spec.ts`).
 *
 * ⚠️ KHOÁ LÀ `file#handler:param`, **KHÔNG PHẢI SỐ DÒNG.** Số dòng trôi ngay ở chính commit vá —
 * thêm một dòng `@Param("id", ParseUUIDPipe)` đẩy mọi site phía sau trong file xuống một dòng
 * ([[index-ratchet-must-pin-definition-not-name]]). `param-uuid-census.ts` xuất `handler` cho đúng
 * việc này; `line` chỉ còn dùng để in thông báo lỗi.
 *
 * ─── LUẬT ĐỌC MỘT DÒNG ─────────────────────────────────────────────────────────────────────────
 * `before` là số **ĐO ĐƯỢC bằng HTTP THẬT trước bản vá**, không phải suy luận. Ba int-spec RED đã
 * được commit và chạy ở trạng thái ĐỎ trước commit vá:
 *   · `test/integration/leave-param-uuid.int-spec.ts`      (lane DB `mediaos_paramuuid2a`)
 *   · `test/integration/attendance-param-uuid.int-spec.ts` (lane DB `mediaos_paramuuid2b`)
 *   · `test/integration/approval-param-uuid.int-spec.ts`   (lane DB `mediaos_paramuuid2c`)
 * Riêng auth-session KHÔNG có spec mới (WO cấm chạm `auth.controller.ts`: chạm auth ⇒ FULL gate, WO
 * này 🟡 LIGHT) — số đo lấy từ spec CÓ SẴN `auth-session-selfservice.int-spec.ts`.
 *
 * ⚠️ GIẢ THUYẾT "mọi id-like unpiped đều 500" đã SAI ngay trong chính nhóm 32 này: `auth-session`
 * trả **404**. Mỗi tham số phải tự đo — đó là lý do cột `before` tồn tại.
 */

/** Quyết định đã ký cho MỘT site. Hai giá trị, không có giá trị thứ ba. */
export type ParamVerdictDecision =
  /** Đã gắn `ParseUUIDPipe` ở biên. Ratchet đòi `site.hasPipe === true`. */
  | "piped"
  /** CỐ Ý không gắn pipe. Ratchet đòi `site.hasPipe === false` — gắn thêm cũng ĐỎ. */
  | "skipped";

export interface ParamVerdict {
  /** Khoá ỔN ĐỊNH `file#handler:param` — khớp `siteKey()` của census. */
  readonly key: string;
  /** Route HTTP tương ứng, để người đọc khỏi phải mở controller. */
  readonly route: string;
  readonly decision: ParamVerdictDecision;
  /** Status + `error.type` ĐO ĐƯỢC bằng HTTP THẬT **trước** bản vá. Cấm ghi "suy ra". */
  readonly before: string;
  /** Vì sao quyết định như vậy. Viết cho người đọc sau, không viết cho linter. */
  readonly reason: string;
}

const PIPED_500 = "vá: 500 GIẢ ⇒ 400 đơn trị ở BIÊN, hợp đồng API đúng, giám sát hết nhiễu";

/**
 * NHÓM ĐỢT-1 — 32 dòng, ĐÚNG MỘT dòng cho mỗi site census thấy trong 7 controller dưới đây.
 * Ratchet ca (5) assert HAI CHIỀU: `decision === 'piped'` ⟺ `site.hasPipe === true`, và ánh xạ
 * site ↔ dòng là SONG ÁNH (thừa dòng ⇒ ĐỎ, thiếu dòng ⇒ ĐỎ).
 */
export const PARAM_UUID_VERDICTS: readonly ParamVerdict[] = [
  // ══ LEAVE (SPEC-05) — 15/15 đo được 500, KHÔNG có phản-ví-dụ nào ═════════════════════════════
  {
    key: "leave/leave.controller.ts#updateType:id",
    route: "PATCH /leave/types/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason:
      "`leave_types` CÓ cột `code` nên phải chứng minh `:id` là UUID chứ không phải mã nghiệp vụ. " +
      "Đã chứng minh bằng HÀNG THẬT (không bằng suy luận): UUID → 200, `code` → không-200 " +
      "(leave-param-uuid.int-spec.ts, ca 'PATCH types/:id nhận UUID'). " +
      PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#getMyRequest:id",
    route: "GET /leave/me/requests/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "22P02 lọt tới tận DB rồi ném thô. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#listBalanceTransactionsCanonical:id",
    route: "GET /leave/balances/:id/transactions",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "22P02 lọt tới tận DB rồi ném thô. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#updateRequestDraft:id",
    route: "PATCH /leave/requests/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Route GHI của FSM nghỉ phép (nhánh Draft). " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#submitRequest:id",
    route: "POST /leave/requests/:id/submit",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Chuyển trạng thái FSM Draft → Pending. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#approveRequest:id",
    route: "POST /leave/requests/:id/approve",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt — lý do chính đưa LEAVE vào đợt-1. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#rejectRequest:id",
    route: "POST /leave/requests/:id/reject",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#cancelRequest:id",
    route: "POST /leave/requests/:id/cancel",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "Chuyển trạng thái FSM. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#revokeRequest:id",
    route: "POST /leave/requests/:id/revoke",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Chuyển trạng thái FSM (thu hồi sau duyệt). " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#updateTypeAdmin:id",
    route: "PATCH /leave/admin/types/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Bản sao quản trị của PATCH /leave/types/:id; UUID → 200 trên hàng thật. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#deleteTypeAdmin:id",
    route: "POST /leave/admin/types/:id/delete",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Soft-delete loại nghỉ (BẤT BIẾN #2 giữ nguyên, pipe chỉ ở BIÊN). " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#updatePolicy:id",
    route: "PATCH /leave/admin/policies/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Loại khoá leave_policy, ALLOW-200 trên hàng thật. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#deletePolicy:id",
    route: "POST /leave/admin/policies/:id/delete",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Soft-delete chính sách phép. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#listBalanceTransactions:id",
    route: "GET /leave/admin/balances/:id/transactions",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "Loại khoá leave_balance, ALLOW-200 trên hàng thật. " + PIPED_500,
  },
  {
    key: "leave/leave.controller.ts#adjustBalance:id",
    route: "POST /leave/admin/balances/:id/adjust",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason:
      "Ghi vào ledger append-only leave_balance_transactions; pipe nằm TRƯỚC service nên " +
      "BẤT BIẾN #2 không đổi. " +
      PIPED_500,
  },

  // ══ ATTENDANCE — điều chỉnh công (SPEC-04, FSM phê duyệt) ════════════════════════════════════
  {
    key: "attendance/attendance-adjustment.controller.ts#getDetail:id",
    route: "GET /attendance/adjustment-requests/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "22P02 lọt tới DB. " + PIPED_500,
  },
  {
    key: "attendance/attendance-adjustment.controller.ts#approve:id",
    route: "POST /attendance/adjustment-requests/:id/approve",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt điều chỉnh công. " + PIPED_500,
  },
  {
    key: "attendance/attendance-adjustment.controller.ts#reject:id",
    route: "POST /attendance/adjustment-requests/:id/reject",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt điều chỉnh công. " + PIPED_500,
  },
  {
    key: "attendance/attendance-adjustment.controller.ts#adjustDirect:id",
    route: "POST /attendance/records/:id/adjust-direct",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Ghi thẳng bản ghi công (route nhạy cảm nhất của SPEC-04). " + PIPED_500,
  },

  // ══ ATTENDANCE — làm việc từ xa (FSM phê duyệt) ══════════════════════════════════════════════
  {
    key: "attendance/remote-work-request.controller.ts#submit:id",
    route: "POST /attendance/remote-work-requests/:id/submit",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Chuyển trạng thái FSM. " + PIPED_500,
  },
  {
    key: "attendance/remote-work-request.controller.ts#getDetail:id",
    route: "GET /attendance/remote-work-requests/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "22P02 lọt tới DB. " + PIPED_500,
  },
  {
    key: "attendance/remote-work-request.controller.ts#approve:id",
    route: "POST /attendance/remote-work-requests/:id/approve",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt. " + PIPED_500,
  },
  {
    key: "attendance/remote-work-request.controller.ts#reject:id",
    route: "POST /attendance/remote-work-requests/:id/reject",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Workflow phê duyệt. " + PIPED_500,
  },
  {
    key: "attendance/remote-work-request.controller.ts#cancelOwn:id",
    route: "POST /attendance/remote-work-requests/:id/cancel",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Chuyển trạng thái FSM. " + PIPED_500,
  },

  // ══ ATTENDANCE — bản ghi công & lịch làm việc ════════════════════════════════════════════════
  {
    key: "attendance/attendance.controller.ts#getRecordLogs:id",
    route: "GET /attendance/records/:id/logs",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "Đọc log append-only của một bản ghi công. " + PIPED_500,
  },
  {
    key: "attendance/attendance.controller.ts#getRecordDetail:id",
    route: "GET /attendance/records/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason:
      "Anh em LITERAL records/export vẫn 200 sau khi gắn pipe (ca chống hồi quy định tuyến). " +
      PIPED_500,
  },
  {
    key: "attendance/attendance.controller.ts#updateSchedule:id",
    route: "PATCH /attendance/schedules/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Loại khoá work_schedule, ALLOW-200 trên hàng thật. " + PIPED_500,
  },

  // ══ ATTENDANCE — ca làm việc & quy tắc ═══════════════════════════════════════════════════════
  {
    key: "attendance/attendance-shift.controller.ts#updateShift:id",
    route: "PATCH /attendance/shifts/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason: "Loại khoá shift, ALLOW-200 trên hàng thật. " + PIPED_500,
  },
  {
    key: "attendance/attendance-shift.controller.ts#updateRule:id",
    route: "PATCH /attendance/rules/:id",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
    reason:
      "Câu hỏi mở của WO: `attendance_rules` có PK `uuid` NHƯNG cũng có `rule_code` — route nhận " +
      "cái nào? Trả lời bằng HÀNG THẬT, không bằng suy luận: UUID → 200 " +
      "(attendance-param-uuid.int-spec.ts, ca ALLOW-200 loại khoá `attendance_rule`). " +
      "Anh em LITERAL `rules/effective` vẫn 200 sau khi gắn pipe. " +
      PIPED_500,
  },

  // ══ APPROVAL (hộp thư phê duyệt dùng chung) ══════════════════════════════════════════════════
  {
    key: "approval/approval-inbox.controller.ts#approve:id",
    route: "POST /approval/requests/:id/approve",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "Anh em LITERAL approval/inbox vẫn 200 sau khi gắn pipe. " + PIPED_500,
  },
  {
    key: "approval/approval-inbox.controller.ts#reject:id",
    route: "POST /approval/requests/:id/reject",
    decision: "piped",
    before: "500 SYSTEM-ERR-001 · error.type='Error'",
    reason: "Workflow phê duyệt dùng chung. " + PIPED_500,
  },

  // ══ AUTH — PHẢN-VÍ-DỤ: đo được 404, KHÔNG vá ════════════════════════════════════════════════
  {
    key: "auth/auth.controller.ts#revokeSession:id",
    route: "POST /auth/sessions/:id/revoke",
    decision: "skipped",
    before:
      "404 NotFoundException (KHÔNG 500) — auth-session-selfservice.int-spec.ts, ca ':id dạng KHÔNG PHẢI uuid → 404'",
    reason:
      "HAI lý do độc lập, cả hai đều đủ để KHÔNG vá. (1) SỰ THẬT ĐO ĐƯỢC: route này KHÔNG hỏng — " +
      "owner-check ở service trả 404 đơn trị cho cả UUID-không-tồn-tại lẫn chuỗi rác, tức nó đã " +
      "hỏng đúng chiều an toàn VÀ không rò việc 'phiên có tồn tại hay không'. Gắn ParseUUIDPipe sẽ " +
      "ĐỔI 404 thành 400 ⇒ tách được hai trường hợp ⇒ đẻ oracle liệt kê session id, tức bản vá làm " +
      "TỆ HƠN. (2) LUẬT WO: `notes` cấm tuyệt đối đưa `auth.controller.ts` vào diff — chạm auth ⇒ " +
      "FULL gate, WO này là 🟡 LIGHT. Vì thế `auth/` KHÔNG BAO GIỜ được thêm vào CLEAN_PREFIXES.",
  },
];

/**
 * Bảy controller mà sổ này TUYÊN BỐ PHỦ ĐỦ. Ratchet ca (5) dùng đúng danh sách này để chọn tập site
 * cần đối chiếu — nhờ đó "quên một dòng verdict" là ĐỎ, không phải im lặng.
 *
 * ⚠️ Thêm file vào đây = tuyên bố "tôi đã ĐO bằng HTTP mọi `:id` của file này", không phải "tôi đã
 * gắn pipe". Đợt 2 (tasks 71 · workflow 36 · goals 21 · employees 21 · org 18 · …) chưa ai đo ⇒
 * chưa được vào.
 */
export const PARAM_UUID_WAVE1_FILES: readonly string[] = [
  "leave/leave.controller.ts",
  "attendance/attendance-adjustment.controller.ts",
  "attendance/remote-work-request.controller.ts",
  "attendance/attendance.controller.ts",
  "attendance/attendance-shift.controller.ts",
  "approval/approval-inbox.controller.ts",
  "auth/auth.controller.ts",
];

/**
 * SÀN chống sổ co về rỗng: 32 tham số của nhóm đợt-1, 31 `piped` + 1 `skipped`.
 * Xoá bớt dòng để "cho lưới xanh" sẽ ĐỎ ở đây trước khi kịp làm hỏng ca (5).
 */
export const PARAM_UUID_WAVE1_SIZE = 32;

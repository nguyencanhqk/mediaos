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
 * Số ĐO ĐƯỢC dùng chung cho ĐỢT 2 — cả 42 tham số ra CÙNG MỘT hình dạng lỗi, nên viết một lần thay
 * vì chép 42 lần (chép tay là cách sai số lẻn vào).
 *
 * ⚠️ Hằng này CHỈ được dùng cho site đã thực sự có một lượt HTTP chứng minh. Nó KHÔNG phải giá trị
 * mặc định để điền cho nhanh: cột `before` là số ĐO, cấm ghi "suy ra". Đợt 1 có phản-ví-dụ
 * (`auth-session` = 404) đúng để nhắc rằng giả thuyết "mọi id-like unpiped đều 500" SAI được.
 */
const BEFORE_500 = "500 SYSTEM-ERR-001 · error.type='Error' (22P02 lọt tới tận DB)";

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

  // ╔══════════════════════════════════════════════════════════════════════════════════════════╗
  // ║  ĐỢT 2 — S10-FND-PARAMUUID-3 (KI-078). 42 tham số / 9 controller của mảng HR + tổ chức.  ║
  // ╚══════════════════════════════════════════════════════════════════════════════════════════╝
  //
  // TIÊU CHÍ CHỌN NHÓM: *dữ liệu nhân sự nhạy cảm (SPEC-03) · có workflow phê duyệt · route GHI ·
  // TRONG PHẠM VI sản phẩm*. Vế cuối là vế mới so với đợt 1 và nó đã LOẠI một ứng viên: `workflow/`
  // (36 tham số) là code hướng cũ đang chờ DỌN (`erd-current.md` §A5 · `backlog.mjs:26`), joint thẳng
  // vào bảng media `content_items`, 0 hộ tiêu thụ FE ⇒ KHÔNG vá, KHÔNG ký verdict (ký `skipped` vẫn
  // buộc dựng fixture media để đo 36 route sắp xoá — xem `docs/plans/S10-FND-PARAMUUID-3.md` §2).
  //
  // SỐ ĐO 27/08/2026, `LANE_DB=mediaos_paramuuid3`, ba int-spec RED chạy ĐỎ TRƯỚC commit vá:
  //   · `test/integration/employees-param-uuid.int-spec.ts`      8 DENY đỏ / 12 ALLOW xanh
  //   · `test/integration/employee-docs-param-uuid.int-spec.ts` 13 DENY đỏ / 11 ALLOW xanh
  //   · `test/integration/org-param-uuid.int-spec.ts`           21 DENY đỏ / 23 ALLOW xanh
  // ⇒ **42/42 đo được 500 SYSTEM-ERR-001 · `error.type='Error'`** — ĐỒNG NHẤT, KHÔNG có phản-ví-dụ
  // nào kiểu `auth-session` (404) của đợt 1. Sau vá: 400 ĐƠN TRỊ + `error.type ∉ {Error, ZodError}`.
  //
  // ⚠️ MỌI ca ALLOW-2xx trên HÀNG THẬT đã XANH NGAY Ở LẦN CHẠY ĐỎ (46/46) ⇒ chứng minh KHÔNG tham số
  // nào trong 42 chỗ này là mã nghiệp vụ/slug. Vế này quan trọng nhất ở `job_levels`/`contract_types`/
  // `positions` — ba bảng VỪA có `id` uuid PK VỪA có cột `code` text riêng (`*_company_code_active_uq`),
  // đúng hình dạng `leave_types` mà đợt 1 phải chứng minh bằng hàng thật.

  // ══ EMPLOYEES — hồ sơ nhân sự (SPEC-03) ══════════════════════════════════════════════════════
  {
    key: "employees/employees.controller.ts#getEmployee:id",
    route: "GET /employees/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Khoá = employee_profiles.id (uuid). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "employees/employees.controller.ts#updateEmployee:id",
    route: "PATCH /employees/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. Body hợp lệ (\`notes\`) ⇒ 400 sau vá không thể do body-pipe. ${PIPED_500}`,
  },
  {
    key: "employees/employees.controller.ts#deleteEmployee:id",
    route: "DELETE /employees/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (soft-delete). ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "employees/hr-read.controller.ts#getEmployee:id",
    route: "GET /hr/employees/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Bề mặt đọc HR có masking lương/PII. Hai literal-sibling CÙNG CẤP (`employees/summary`, " +
      "`employees/export`) khai TRƯỚC route `:id` nên pipe không đụng định tuyến — ghim lại bằng ca " +
      `ĐỊNH TUYẾN 200 chứ không bằng lập luận. ${PIPED_500}`,
  },

  // ══ EMPLOYEES — yêu cầu đổi hồ sơ (FSM phê duyệt, SPEC-03 §14.18-20) ═════════════════════════
  {
    key: "employees/profile-change-request.controller.ts#getDetail:id",
    route: "GET /hr/profile-change-requests/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Own-scope ép ở service (`:255-258`): actor không phải chủ ⇒ 404. Literal-sibling `me` khai " +
      "TRƯỚC route `:id` (`:65`) ⇒ có ca ĐỊNH TUYẾN 200. " +
      PIPED_500,
  },
  {
    key: "employees/profile-change-request.controller.ts#approveRequest:id",
    route: "POST /hr/profile-change-requests/:id/approve",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Bước DUYỆT của FSM — đúng lớp route mà đợt 1 ưu tiên. ALLOW-200 trên PCR `Pending` hàng thật " +
      `(@HttpCode(200)), field KHÔNG nhạy cảm để tránh cổng \`view-identity:employee\`. ${PIPED_500}`,
  },
  {
    key: "employees/profile-change-request.controller.ts#rejectRequest:id",
    route: "POST /hr/profile-change-requests/:id/reject",
    decision: "piped",
    before: BEFORE_500,
    reason: `Bước TỪ CHỐI của FSM. Body hợp lệ (\`rejectionReason\` min(1)) khi đo. ${PIPED_500}`,
  },
  {
    key: "employees/profile-change-request.controller.ts#cancelRequest:id",
    route: "POST /hr/profile-change-requests/:id/cancel",
    decision: "piped",
    before: BEFORE_500,
    reason: `Bước HUỶ của FSM, own-scope ép ở service (\`:486-492\`). ${PIPED_500}`,
  },

  // ══ EMPLOYEES — hợp đồng lao động ════════════════════════════════════════════════════════════
  {
    key: "employees/contract.controller.ts#listForEmployee:id",
    route: "GET /hr/employees/:id/contracts",
    decision: "piped",
    before: BEFORE_500,
    reason: `\`:id\` ở đây là employee_profiles.id, KHÔNG phải contract id. ${PIPED_500}`,
  },
  {
    key: "employees/contract.controller.ts#getById:id",
    route: "GET /hr/contracts/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "`employee_contracts` CÓ cột `contract_code` ⇒ phải chứng minh `:id` là UUID chứ không phải mã " +
      `hợp đồng. Đã chứng minh bằng HÀNG THẬT: ALLOW-200; UUID không tồn tại → 404 đơn trị. ${PIPED_500}`,
  },
  {
    key: "employees/contract.controller.ts#update:id",
    route: "PATCH /hr/contracts/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật với body hợp lệ. ${PIPED_500}`,
  },
  {
    key: "employees/contract.controller.ts#linkFile:id",
    route: "POST /hr/contracts/:id/file",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Route GHI. ALLOW-**201** (`@Post` KHÔNG khai `@HttpCode` ⇒ mặc định Nest). `fileId` trong body " +
      `là UUID THẬT khi đo ⇒ 400 quan sát được không thể đến từ body-pipe. ${PIPED_500}`,
  },
  {
    key: "employees/contract.controller.ts#delete:id",
    route: "DELETE /hr/contracts/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },

  // ══ EMPLOYEES — hồ sơ đính kèm (`:id` CẤP CLASS + `:fileId` cấp method) ══════════════════════
  //
  // ⚠️ NĂM route dưới đây mang HAI tham số id-like. Census đếm chúng là HAI site, nên ca DENY đo
  // RIÊNG từng vế: rác ở `:id` (với `:fileId` HỢP LỆ) và rác ở `:fileId` (với `:id` HỢP LỆ). Đo một
  // vế rồi ký cả hai dòng chính là "ký verdict cho chỗ chưa đo" mà WO cấm.
  {
    key: "employees/employee-file.controller.ts#list:id",
    route: "GET /hr/employees/:id/files",
    decision: "piped",
    before: BEFORE_500,
    reason: `\`:id\` khai ở \`@Controller("hr/employees/:id/files")\` — cấp CLASS. ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#getOne:id",
    route: "GET /hr/employees/:id/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:id\` đo RIÊNG (\`:fileId\` HỢP LỆ trong ca đo). ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#getOne:fileId",
    route: "GET /hr/employees/:id/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:fileId\` đo RIÊNG (\`:id\` HỢP LỆ trong ca đo). Khoá = files.id. ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#download:id",
    route: "GET /hr/employees/:id/files/:fileId/download",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:id\` đo RIÊNG. ALLOW-**302** (\`res.redirect\`, KHÔNG qua envelope). ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#download:fileId",
    route: "GET /hr/employees/:id/files/:fileId/download",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Vế `:fileId` đo RIÊNG. Fixture phải `scan_status='Clean'` — scan-guard STRICT trả 409 cho " +
      `Pending/Infected, ca ALLOW sẽ đỏ vì lý do KHÔNG liên quan tới tham số. ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#link:id",
    route: "POST /hr/employees/:id/files",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-**201** (\`@Post\` không khai \`@HttpCode\`). ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#remove:id",
    route: "DELETE /hr/employees/:id/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:id\` đo RIÊNG. Route GHI (soft-delete). ${PIPED_500}`,
  },
  {
    key: "employees/employee-file.controller.ts#remove:fileId",
    route: "DELETE /hr/employees/:id/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:fileId\` đo RIÊNG. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },

  // ══ ORG — đơn vị tổ chức + team ══════════════════════════════════════════════════════════════
  {
    key: "org/org.controller.ts#updateOrgUnit:id",
    route: "PATCH /org/units/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "`org_units` CÓ cột `code` ⇒ phải chứng minh `:id` là UUID. ALLOW-200 trên hàng thật. " +
      `Literal-sibling \`GET units/tree\` khai TRƯỚC (\`:88\`) — khác METHOD nên không va, vẫn ghim ca 200. ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#deleteOrgUnit:id",
    route: "DELETE /org/units/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#updateTeam:id",
    route: "PATCH /org/teams/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `\`teams\` CÓ cột \`code\`; ALLOW-200 trên hàng thật chứng minh \`:id\` là UUID. ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#assignTeamLeader:id",
    route: "PATCH /org/teams/:id/leader",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. \`leaderId\` trong body là UUID THẬT khi đo ⇒ 400 không do body. ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#deleteTeam:id",
    route: "DELETE /org/teams/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#listTeamMembers:id",
    route: "GET /org/teams/:id/members",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Đường đọc dữ liệu VỀ NGƯỜI — service bound thêm cặp danh bạ `view:user` (S6-SEC-ORGTEAMSCOPE-1), " +
      `nên ca đo phải mang cả cặp đó kẻo ALLOW đo được 403 thay vì hành vi tham số. ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#addTeamMember:id",
    route: "POST /org/teams/:id/members",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-**201** (\`@Post\` không khai \`@HttpCode\`). ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#removeTeamMember:id",
    route: "DELETE /org/teams/:id/members/:userId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Vế \`:id\` (teamId) đo RIÊNG với \`:userId\` HỢP LỆ. ${PIPED_500}`,
  },
  {
    key: "org/org.controller.ts#removeTeamMember:userId",
    route: "DELETE /org/teams/:id/members/:userId",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Vế `:userId` đo RIÊNG với `:id` HỢP LỆ. Khoá = users.id — tham số KHÔNG tên `id`, nên grep " +
      'theo `@Param("id")` sẽ TRƯỢT nó ([[identity-projection-census-misses-alias]]). ' +
      PIPED_500,
  },

  // ══ ORG — phòng ban (cùng bảng org_units, bề mặt HR) ═════════════════════════════════════════
  {
    key: "org/hr-department.controller.ts#getDepartment:id",
    route: "GET /hr/departments/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      "Bề mặt HR của CÙNG bảng `org_units` (`hr-department.repository.ts:4`). ALLOW-200 trên hàng " +
      `thật; UUID hợp lệ không tồn tại → 404 đơn trị. ${PIPED_500}`,
  },
  {
    key: "org/hr-department.controller.ts#updateDepartment:id",
    route: "PATCH /hr/departments/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "org/hr-department.controller.ts#deleteDepartment:id",
    route: "DELETE /hr/departments/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },

  // ══ ORG — danh mục HR: job_levels + contract_types (BẢNG CÓ CỘT `code`) ══════════════════════
  //
  // ⚠️ Đây là cụm rủi ro "đếm oan" cao nhất của đợt 2: cả hai bảng có `id` uuid PK VÀ `code` text
  // riêng + `*_company_code_active_uq`. Nếu `:id` thực ra nhận `code` thì `ParseUUIDPipe` CHẶN OAN
  // request hợp lệ, mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh. Ca ALLOW-2xx trên HÀNG THẬT
  // là vế duy nhất phát hiện được — và nó ĐÃ XANH ngay ở lần chạy ĐỎ.
  {
    key: "org/hr-master-data.controller.ts#getJobLevel:id",
    route: "GET /hr/master-data/job-levels/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ \`:id\` là \`job_levels.id\` (uuid), KHÔNG phải \`code\`. ${PIPED_500}`,
  },
  {
    key: "org/hr-master-data.controller.ts#updateJobLevel:id",
    route: "PATCH /hr/master-data/job-levels/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "org/hr-master-data.controller.ts#deleteJobLevel:id",
    route: "DELETE /hr/master-data/job-levels/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "org/hr-master-data.controller.ts#getContractType:id",
    route: "GET /hr/master-data/contract-types/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ \`:id\` là \`contract_types.id\` (uuid), KHÔNG phải \`code\`. ${PIPED_500}`,
  },
  {
    key: "org/hr-master-data.controller.ts#updateContractType:id",
    route: "PATCH /hr/master-data/contract-types/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "org/hr-master-data.controller.ts#deleteContractType:id",
    route: "DELETE /hr/master-data/contract-types/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },

  // ══ POSITIONS — chức danh (BẢNG CÓ CỘT `code`) ═══════════════════════════════════════════════
  {
    key: "positions/positions.controller.ts#getPosition:id",
    route: "GET /org/positions/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ \`:id\` là \`positions.id\` (uuid), KHÔNG phải \`code\`. ${PIPED_500}`,
  },
  {
    key: "positions/positions.controller.ts#updatePosition:id",
    route: "PATCH /org/positions/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "positions/positions.controller.ts#deletePosition:id",
    route: "DELETE /org/positions/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
];

/**
 * **16 controller** mà sổ này TUYÊN BỐ PHỦ ĐỦ. Ratchet ca (5) dùng đúng danh sách này để chọn tập
 * site cần đối chiếu — nhờ đó "quên một dòng verdict" là ĐỎ, không phải im lặng.
 *
 * ⚠️ Thêm file vào đây = tuyên bố **"tôi đã ĐO bằng HTTP mọi `:id` của file này"**, KHÔNG phải "tôi
 * đã gắn pipe". Đó là lý do danh sách này KHÔNG khớp `CLEAN_PREFIXES` của ratchet và KHÔNG được cho
 * khớp: `employees/hr-write.controller.ts` + `employees/hr-employee-avatar.controller.ts` đã CÓ pipe
 * từ trước nên prefix `employees/` sạch, nhưng CHƯA ai đo chúng bằng HTTP ⇒ **không vào đây**.
 *
 * ⟲ S10-FND-PARAMUUID-3 (đợt 2) đổi tên hằng từ `PARAM_UUID_WAVE1_*` sang `PARAM_UUID_MEASURED_*`:
 * cái tên cũ ngụ ý "một đợt", mà bất biến thật là "mọi site trong các file này đều có một dòng
 * verdict tựa trên số đo". Đặt tên theo bất biến thì đợt 3 chỉ việc thêm file, không phải đổi tên lại.
 *
 * CÒN NỢ (chưa file nào vào được vì chưa ai đo): `tasks/` 75 · `goals/` 21 ·
 * `foundation/`-ngoài-`files/` 8 · `notifications/` 6 · `recycle-bin/` 1 = **111 trong phạm vi**;
 * cộng `workflow/` 36 (code PARK, xem khối đợt-2 ở trên) = 147, cộng `auth/` 1 đã ký `skipped` = 148.
 */
export const PARAM_UUID_MEASURED_FILES: readonly string[] = [
  // ── Đợt 1 — S10-FND-PARAMUUID-2 (32 site) ────────────────────────────────────────────────────
  "leave/leave.controller.ts",
  "attendance/attendance-adjustment.controller.ts",
  "attendance/remote-work-request.controller.ts",
  "attendance/attendance.controller.ts",
  "attendance/attendance-shift.controller.ts",
  "approval/approval-inbox.controller.ts",
  "auth/auth.controller.ts",
  // ── Đợt 2 — S10-FND-PARAMUUID-3 (42 site) ────────────────────────────────────────────────────
  "employees/employees.controller.ts",
  "employees/hr-read.controller.ts",
  "employees/profile-change-request.controller.ts",
  "employees/contract.controller.ts",
  "employees/employee-file.controller.ts",
  "org/org.controller.ts",
  "org/hr-department.controller.ts",
  "org/hr-master-data.controller.ts",
  "positions/positions.controller.ts",
];

/**
 * SÀN chống sổ co về rỗng: **74** tham số đã đo — 32 của đợt 1 (31 `piped` + 1 `skipped`) + 42 của
 * đợt 2 (42 `piped`, KHÔNG có `skipped` nào: cả 42 đều đo được 500).
 * Xoá bớt dòng để "cho lưới xanh" sẽ ĐỎ ở đây trước khi kịp làm hỏng ca (5).
 */
export const PARAM_UUID_MEASURED_SIZE = 74;

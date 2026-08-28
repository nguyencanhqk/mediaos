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
 *     ⓘ File này ĐÃ XOÁ ở `S10-CLEAN-WORKFLOWCLUSTER-2` cùng module `approval/`. Giữ dòng này như
 *     GHI CHÉP LỊCH SỬ (số đo `before` của đợt 1 có thật, đã chạy ĐỎ) — đừng đi tìm file.
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

  // ══ APPROVAL — HAI verdict `piped` của `approval/approval-inbox.controller.ts` ĐÃ GỠ ═══════════
  // `S10-CLEAN-WORKFLOWCLUSTER-2` xoá cả module `approval/`: 3 route của nó không còn tồn tại để đo.
  // Verdict là sổ phán quyết cho SITE ĐANG SỐNG — giữ hai dòng trỏ file đã xoá thì sổ nói dối.
  // ⛔ KHÔNG phải nới ratchet: hai site đó vốn đã PIPED nên chưa bao giờ nằm trong `UNPIPED_CEILING`.

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

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ĐỢT 3 — S10-FND-PARAMUUID-4 (KI-078): 36 tham số, "khép mọi module TRONG PHẠM VI trừ `tasks/`".
  //
  // Tiêu chí đợt này là CẤU TRÚC, không phải rủi ro nghiệp vụ (hai đợt trước): nhận trọn phần trong
  // phạm vi TRỪ `tasks/` để `CLEAN_PREFIXES` khép được 4 prefix về 0 — vá 36/75 chỗ của `tasks/`
  // KHÔNG nới được prefix nào, và tham số `tasks/` thứ 76 vẫn lẻn vào được dưới trần chung.
  // Lý lẽ + cái giá phải trả: docs/plans/S10-FND-PARAMUUID-4.md §2.
  //
  // **36/36 đo được 500 — KHÔNG có phản-ví-dụ nào** (đợt 1 có một: `auth-session` = 404).
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // ══ GOALS (SPEC-10) — mục tiêu/OKR. BẢNG CÓ `goal_code` ═════════════════════════════════════
  {
    key: "goals/goals.controller.ts#getOne:id",
    route: "GET /goals/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ \`:id\` là \`goals.id\` (uuid), KHÔNG phải \`goal_code\`. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#update:id",
    route: "PATCH /goals/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật (mục tiêu cấp PHÒNG BAN — cấp company bị chặn ở MVP, GOAL-ERR-004). ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#remove:id",
    route: "DELETE /goals/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM). ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#checkIn:id",
    route: "POST /goals/:id/check-in",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên hàng thật status='Active' (FSM đòi Active — goal-checkin.service.ts:74). ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#updates:id",
    route: "GET /goals/:id/updates",
    decision: "piped",
    before: BEFORE_500,
    reason: `Sổ append-only. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#finalize:id",
    route: "POST /goals/:id/finalize",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (chốt kỳ). ALLOW-201 trên hàng thật Active + CHƯA chốt (goal-checkin.service.ts:158,168). ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#reopen:id",
    route: "POST /goals/:id/reopen",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (mở lại). ALLOW-201 trên hàng thật ĐÃ chốt \`finalized_at\` (goal-checkin.service.ts:210). ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#linkedTasks:id",
    route: "GET /goals/:id/tasks",
    decision: "piped",
    before: BEFORE_500,
    reason: `Hai cổng (view:goal + read:task ở service). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#linkTasks:id",
    route: "POST /goals/:id/tasks",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (gắn BULK). ALLOW-201 trên hàng thật; ca DENY gửi \`taskIds\` UUID THẬT ⇒ 400 không thể đến từ body-pipe. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#unlinkTask:id",
    route: "DELETE /goals/:id/tasks/:taskId — VẾ :id",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:taskId\` HỢP LỆ). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#unlinkTask:taskId",
    route: "DELETE /goals/:id/tasks/:taskId — VẾ :taskId",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:id\` HỢP LỆ) ⇒ loại khoá \`tasks.id\`. ALLOW-200 trên task ĐANG gắn. ${PIPED_500}`,
  },
  {
    key: "goals/goals.controller.ts#decompose:id",
    route: "POST /goals/:id/decompose",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BULK trong 1 tx. ALLOW-201 trên hàng thật; ca DENY gửi \`templateId\` UUID THẬT + \`items\` hợp lệ. ${PIPED_500}`,
  },

  // ══ TASK TEMPLATES (SPEC-10 §15) — danh mục mẫu công việc ═══════════════════════════════════
  {
    key: "goals/task-templates.controller.ts#getOne:id",
    route: "GET /task-templates/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ loại khoá \`task_templates.id\`. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#update:id",
    route: "PATCH /task-templates/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (chỉ HEADER). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#remove:id",
    route: "DELETE /task-templates/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM + cascade mềm xuống items). ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#listItems:templateId",
    route: "GET /task-templates/:templateId/items",
    decision: "piped",
    before: BEFORE_500,
    reason: `Alias \`*Id\` — census theo \`@Param("id")\` sẽ TRƯỢT nó. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#createItem:templateId",
    route: "POST /task-templates/:templateId/items",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên hàng thật (@Post không khai @HttpCode ⇒ 201). ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#updateItem:templateId",
    route: "PATCH /task-templates/:templateId/items/:itemId — VẾ :templateId",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:itemId\` HỢP LỆ). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#updateItem:itemId",
    route: "PATCH /task-templates/:templateId/items/:itemId — VẾ :itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:templateId\` HỢP LỆ) ⇒ loại khoá \`task_template_items.id\`. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#removeItem:templateId",
    route: "DELETE /task-templates/:templateId/items/:itemId — VẾ :templateId",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:itemId\` HỢP LỆ). ALLOW-204 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "goals/task-templates.controller.ts#removeItem:itemId",
    route: "DELETE /task-templates/:templateId/items/:itemId — VẾ :itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `HAI tham số id-like: đo RIÊNG vế này (\`:templateId\` HỢP LỆ). ALLOW-204 trên hàng thật. ${PIPED_500}`,
  },

  // ══ FOUNDATION — audit viewer. ⚠️ /all/:id là @OperatorOnly ═════════════════════════════════
  {
    key: "foundation/audit/audit.controller.ts#getSystemDetail:id",
    route: "GET /foundation/audit-logs/all/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `@OperatorOnly ⇒ ĐO BẰNG TOKEN audience='operator' (PLATFORM_ADMIN_ROLE); actor tenant ăn 401 ` +
      `TRƯỚC pipe nên KHÔNG đo được gì. Spec có hai ca NEO cho cả hai chiều. ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },
  {
    key: "foundation/audit/audit.controller.ts#getCompanyDetail:id",
    route: "GET /foundation/audit-logs/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `COMPANY scope (view:audit-log, is_sensitive). ALLOW-200 trên hàng thật. Ca ĐỊNH TUYẾN ghim ` +
      `\`/audit-logs/all\` — literal MỘT segment nên nó KHỚP \`:id\`, chỉ THỨ TỰ KHAI BÁO cứu nó. ${PIPED_500}`,
  },

  // ══ FOUNDATION — ngày nghỉ. BẢNG CÓ `holiday_code` ══════════════════════════════════════════
  {
    key: "foundation/holidays/holidays.controller.ts#update:id",
    route: "PATCH /foundation/public-holidays/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên hàng thật ⇒ \`:id\` là uuid, KHÔNG phải \`holiday_code\`. ${PIPED_500}`,
  },
  {
    key: "foundation/holidays/holidays.controller.ts#remove:id",
    route: "DELETE /foundation/public-holidays/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-**200** trên hàng thật — @HttpCode(200), KHÔNG phải 204 mặc định. ${PIPED_500}`,
  },

  // ══ FOUNDATION — retention governance ═══════════════════════════════════════════════════════
  {
    key: "foundation/retention/retention.controller.ts#simulate:id",
    route: "POST /foundation/retention-policies/:id/simulate",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `READ-ONLY preview, gate manage:foundation-retention (is_sensitive ⇒ wildcard KHÔNG kế thừa). ` +
      `ALLOW-200 trên hàng thật (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "foundation/retention/retention.controller.ts#update:id",
    route: "PATCH /foundation/retention-policies/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (is_sensitive, System-scope). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },

  // ══ FOUNDATION — sequence. BẢNG CẤP MÃ, có `sequence_key` ═══════════════════════════════════
  {
    key: "foundation/sequences/sequence.controller.ts#preview:id",
    route: "GET /foundation/sequences/:id/preview",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `Bảng CẤP MÃ ⇒ ứng viên "\`:id\` thực ra là khoá nghiệp vụ" nặng nhất của đợt 3. ALLOW-200 trên ` +
      `hàng thật CHỨNG MINH \`:id\` là uuid, KHÔNG phải \`sequence_key\`. ${PIPED_500}`,
  },
  {
    key: "foundation/sequences/sequence.controller.ts#update:id",
    route: "PATCH /foundation/sequences/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (cấu hình mutable + audit-in-tx). ALLOW-200 trên hàng thật. ${PIPED_500}`,
  },

  // ══ NOTIFICATIONS (SPEC-08) — của TÔI, own-scope tuyệt đối ══════════════════════════════════
  {
    key: "notifications/my-notifications.controller.ts#detail:id",
    route: "GET /notifications/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Own-scope theo \`recipient_user_id\`. ALLOW-200 trên hàng thật + ALLOW-404 trên uuid không tồn tại. ${PIPED_500}`,
  },
  {
    key: "notifications/my-notifications.controller.ts#markRead:id",
    route: "POST /notifications/:id/mark-read",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (idempotent). ALLOW-200 trên hàng thật (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "notifications/my-notifications.controller.ts#remove:id",
    route: "DELETE /notifications/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM — BẤT BIẾN #2). ALLOW-204 trên hàng thật (@HttpCode(204)). ${PIPED_500}`,
  },

  // ══ NOTIFICATIONS — quản trị catalog. BẢNG CÓ `event_code`/`template_code` ══════════════════
  {
    key: "notifications/notification-admin.controller.ts#patchEvent:id",
    route: "PATCH /notifications/events/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `Catalog mang \`event_code\` (NOTI-EVENT-XXX) ⇒ ứng viên "\`:id\` là MÃ". ALLOW-200 trên hàng ` +
      `THẬT CỦA TENANT (không mượn hàng global — ghi lên hàng global là đổi dữ liệu dùng chung). ${PIPED_500}`,
  },
  {
    key: "notifications/notification-admin.controller.ts#getTemplate:id",
    route: "GET /notifications/templates/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `ALLOW-200 trên hàng thật ⇒ \`:id\` là uuid, KHÔNG phải \`template_code\`. ${PIPED_500}`,
  },
  {
    key: "notifications/notification-admin.controller.ts#patchTemplate:id",
    route: "PATCH /notifications/templates/:id",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `Route GHI (company-override). ALLOW-200 trên hàng thật; ca DENY gửi \`title_template\` KHÔNG ` +
      `chứa biến ⇒ 400 không thể đến từ assertTemplateVariablesSafe (422). ${PIPED_500}`,
  },

  // ══ RECYCLE BIN — khôi phục hồ sơ đã xoá mềm ════════════════════════════════════════════════
  {
    key: "recycle-bin/recycle-bin.controller.ts#restoreEmployee:id",
    route: "POST /recycle-bin/employees/:id/restore",
    decision: "piped",
    before: BEFORE_500,
    reason:
      `Route GHI, gate restore:employee (is_sensitive). ALLOW-200 trên \`employee_profiles\` ĐÃ xoá ` +
      `mềm (@HttpCode(200)). ${PIPED_500}`,
  },

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ĐỢT 4 — S10-FND-PARAMUUID-5 (KI-078, đợt CUỐI trong phạm vi): **75 site / 5 controller** của
  // module `tasks/` (SPEC-06) — phần nợ THẬT cuối cùng. Đo 27/08/2026 trên `LANE_DB=mediaos_paramuuid5`
  // bằng ba int-spec RED→GREEN:
  //   · `test/integration/tasks-core-param-uuid.int-spec.ts`   (43 site, tasks.controller.ts)
  //   · `test/integration/projects-param-uuid.int-spec.ts`     (21 site, projects · labels · project-states)
  //   · `test/integration/task-files-param-uuid.int-spec.ts`   (11 site, task-files.controller.ts)
  // **75/75 đo được 500 SYSTEM-ERR-001 · error.type='Error'. KHÔNG có phản-ví-dụ** (đợt 1 có một:
  // `auth-session` = 404). Mỗi vế của route nhiều tham số được đo RIÊNG — rác ở vế đang đo, hàng
  // THẬT ở các vế còn lại; ký cả hai dòng từ MỘT lượt đo là ký cho chỗ chưa đo.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  {
    key: "tasks/tasks.controller.ts#getProjectTasks:projectId",
    route: "GET /tasks/by-project/:projectId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc task theo DỰ ÁN. ALLOW-200 trên dự án THẬT ⇒ \`:projectId\` là uuid. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#getTeamTasks:teamId",
    route: "GET /tasks/by-team/:teamId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc task theo TEAM. ALLOW-200 trên team THẬT (có thành viên — \`teamExistsTx\` tra \`team_members\`, KHÔNG tra \`teams\`). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#getTask:taskId",
    route: "GET /tasks/:taskId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Chi tiết task. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#listSubtasks:taskId",
    route: "GET /tasks/:taskId/subtasks",
    decision: "piped",
    before: BEFORE_500,
    reason: `Danh sách việc con. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#reorderSubtasks:taskId",
    route: "PATCH /tasks/:taskId/subtasks/reorder",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên CÂY THẬT (cha + 1 con). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateStatus:taskId",
    route: "PATCH /tasks/:taskId/status",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI legacy (@deprecated, cột \`status\` lowercase). ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateTask:taskId",
    route: "PATCH /tasks/:taskId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteTask:taskId",
    route: "DELETE /tasks/:taskId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM — BẤT BIẾN #2). ALLOW-204 trên task THẬT (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addLabel:taskId",
    route: "POST /tasks/:taskId/labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-2xx gắn nhãn THẬT vào task THẬT. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addLabel:labelId",
    route: "POST /tasks/:taskId/labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-2xx gắn nhãn THẬT vào task THẬT. (vế \`labelId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#removeLabel:taskId",
    route: "DELETE /tasks/:taskId/labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 gỡ nhãn THẬT ĐÃ gắn (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#removeLabel:labelId",
    route: "DELETE /tasks/:taskId/labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 gỡ nhãn THẬT ĐÃ gắn (@HttpCode(204)). (vế \`labelId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#getComments:taskId",
    route: "GET /tasks/:taskId/comments",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc bình luận. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addComment:taskId",
    route: "POST /tasks/:taskId/comments",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateComment:taskId",
    route: "PATCH /tasks/:taskId/comments/:commentId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên bình luận THẬT (self-only). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateComment:commentId",
    route: "PATCH /tasks/:taskId/comments/:commentId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên bình luận THẬT (self-only). (vế \`commentId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteComment:taskId",
    route: "DELETE /tasks/:taskId/comments/:commentId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM bình luận THẬT (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteComment:commentId",
    route: "DELETE /tasks/:taskId/comments/:commentId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM bình luận THẬT (@HttpCode(204)). (vế \`commentId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#assignTask:taskId",
    route: "POST /tasks/:taskId/assign",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI crown-FSM. ALLOW-200 trên task THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#changeTaskStatus:taskId",
    route: "POST /tasks/:taskId/change-status",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI crown-FSM. ALLOW-200 Todo→In Progress trên task THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#moveTask:taskId",
    route: "POST /tasks/:taskId/move",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route sugar Kanban (@deprecated) — gọi CHÍNH changeStatus. ALLOW-200 trên task THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#moveTaskState:taskId",
    route: "POST /tasks/:taskId/move-state",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI cột pipeline. ALLOW-200 trên task THẬT + cột THẬT của cùng dự án (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#changeTaskPriority:taskId",
    route: "POST /tasks/:taskId/change-priority",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên task THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#changeTaskDeadline:taskId",
    route: "POST /tasks/:taskId/change-deadline",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên task THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#listWatchers:taskId",
    route: "GET /tasks/:taskId/watchers",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc người theo dõi. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addWatcher:taskId",
    route: "POST /tasks/:taskId/watchers",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (self-only MVP, body rỗng hợp lệ). ALLOW-2xx trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#removeWatcher:taskId",
    route: "DELETE /tasks/:taskId/watchers/:watcherId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 trên watcher THẬT của chính actor (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#removeWatcher:watcherId",
    route: "DELETE /tasks/:taskId/watchers/:watcherId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 trên watcher THẬT của chính actor (@HttpCode(204)). (vế \`watcherId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#listChecklists:taskId",
    route: "GET /tasks/:taskId/checklists",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc checklist. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#createChecklist:taskId",
    route: "POST /tasks/:taskId/checklists",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateChecklist:taskId",
    route: "PATCH /tasks/:taskId/checklists/:checklistId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên checklist THẬT. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateChecklist:checklistId",
    route: "PATCH /tasks/:taskId/checklists/:checklistId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên checklist THẬT. (vế \`checklistId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteChecklist:taskId",
    route: "DELETE /tasks/:taskId/checklists/:checklistId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM cascade xuống item (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteChecklist:checklistId",
    route: "DELETE /tasks/:taskId/checklists/:checklistId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM cascade xuống item (@HttpCode(204)). (vế \`checklistId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addChecklistItem:taskId",
    route: "POST /tasks/:taskId/checklists/:checklistId/items",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-201 trên checklist THẬT. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#addChecklistItem:checklistId",
    route: "POST /tasks/:taskId/checklists/:checklistId/items",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-201 trên checklist THẬT. (vế \`checklistId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateChecklistItem:taskId",
    route: "PATCH /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG (rác ở vế đang đo, hàng THẬT ở hai vế kia). ALLOW-200 tick item THẬT. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateChecklistItem:checklistId",
    route: "PATCH /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG (rác ở vế đang đo, hàng THẬT ở hai vế kia). ALLOW-200 tick item THẬT. (vế \`checklistId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#updateChecklistItem:itemId",
    route: "PATCH /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG (rác ở vế đang đo, hàng THẬT ở hai vế kia). ALLOW-200 tick item THẬT. (vế \`itemId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteChecklistItem:taskId",
    route: "DELETE /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM item THẬT (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteChecklistItem:checklistId",
    route: "DELETE /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM item THẬT (@HttpCode(204)). (vế \`checklistId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#deleteChecklistItem:itemId",
    route: "DELETE /tasks/:taskId/checklists/:checklistId/items/:itemId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI BA tham số — mỗi vế đo RIÊNG. ALLOW-204 xoá MỀM item THẬT (@HttpCode(204)). (vế \`itemId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/tasks.controller.ts#listActivity:taskId",
    route: "GET /tasks/:taskId/activity",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc feed hoạt động (task_activity_logs, append-only). ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#getOne:id",
    route: "GET /projects/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Chi tiết dự án. \`projects\` MANG \`project_code\` ⇒ ứng viên "\`:id\` là MÃ"; ALLOW-200 trên dự án THẬT CHỨNG MINH \`:id\` là uuid. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#update:id",
    route: "PATCH /projects/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#close:id",
    route: "POST /projects/:id/close",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI verb, gate close:project (is_sensitive). ALLOW-200 trên dự án THẬT (@HttpCode(200)). ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#remove:id",
    route: "DELETE /projects/:id",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM), gate delete:project (is_sensitive). ALLOW-204 trên dự án THẬT (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#listMembers:id",
    route: "GET /projects/:id/members",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc thành viên. ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#addMember:id",
    route: "POST /projects/:id/members",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI, gate manage-member:project (is_sensitive). ALLOW-201 với nhân viên THẬT có tài khoản + status active. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#updateMember:id",
    route: "PATCH /projects/:id/members/:memberId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên thành viên THẬT. (vế \`id\`) ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#updateMember:memberId",
    route: "PATCH /projects/:id/members/:memberId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên thành viên THẬT. (vế \`memberId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#removeMember:id",
    route: "DELETE /projects/:id/members/:memberId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 soft-remove thành viên THẬT (@HttpCode(204)). (vế \`id\`) ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#removeMember:memberId",
    route: "DELETE /projects/:id/members/:memberId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI hai tham số — mỗi vế đo RIÊNG. ALLOW-204 soft-remove thành viên THẬT (@HttpCode(204)). (vế \`memberId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#getKanban:id",
    route: "GET /projects/:id/kanban",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc board, gate view-kanban:task (resource \`task\`, KHÔNG phải \`project\`). ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#getReport:id",
    route: "GET /projects/:id/report",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc báo cáo, gate view-report:project (is_sensitive). ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/projects.controller.ts#listActivity:id",
    route: "GET /projects/:id/activity",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc feed dự án, gate view:task-audit-log (is_sensitive). ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#list:taskId",
    route: "GET /tasks/:taskId/files",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc đính kèm. ALLOW-200 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#getOne:taskId",
    route: "GET /tasks/:taskId/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc metadata, hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên tệp THẬT ĐÃ đính kèm. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#getOne:fileId",
    route: "GET /tasks/:taskId/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc metadata, hai tham số — mỗi vế đo RIÊNG. ALLOW-200 trên tệp THẬT ĐÃ đính kèm. (vế \`fileId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#download:taskId",
    route: "GET /tasks/:taskId/files/:fileId/download",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đường TẢI (302 signed-url, scan-guard STRICT), hai tham số — mỗi vế đo RIÊNG. ALLOW-302 trên tệp THẬT Uploaded+Clean. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#download:fileId",
    route: "GET /tasks/:taskId/files/:fileId/download",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đường TẢI (302 signed-url, scan-guard STRICT), hai tham số — mỗi vế đo RIÊNG. ALLOW-302 trên tệp THẬT Uploaded+Clean. (vế \`fileId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#linkFile:taskId",
    route: "POST /tasks/:taskId/files",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (gắn tệp đã upload). ALLOW-201 trên task THẬT + tệp THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#setCover:taskId",
    route: "POST /tasks/:taskId/files/:fileId/cover",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (bật \`is_primary\` trên CHÍNH dòng đính kèm), hai tham số — mỗi vế đo RIÊNG. ALLOW-201 trên tệp ẢNH THẬT. (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#setCover:fileId",
    route: "POST /tasks/:taskId/files/:fileId/cover",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (bật \`is_primary\` trên CHÍNH dòng đính kèm), hai tham số — mỗi vế đo RIÊNG. ALLOW-201 trên tệp ẢNH THẬT. (vế \`fileId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#clearCover:taskId",
    route: "DELETE /tasks/:taskId/files/cover",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI idempotent. \`cover\` là ANH EM LITERAL của \`:fileId\` (khai TRƯỚC) ⇒ ca định tuyến riêng đo 204 trên task THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#remove:taskId",
    route: "DELETE /tasks/:taskId/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM), hai tham số — mỗi vế đo RIÊNG. ALLOW-204 trên tệp THẬT (@HttpCode(204)). (vế \`taskId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/task-files.controller.ts#remove:fileId",
    route: "DELETE /tasks/:taskId/files/:fileId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM), hai tham số — mỗi vế đo RIÊNG. ALLOW-204 trên tệp THẬT (@HttpCode(204)). (vế \`fileId\`) ${PIPED_500}`,
  },
  {
    key: "tasks/labels.controller.ts#listLabels:projectId",
    route: "GET /projects/:projectId/labels",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc nhãn của dự án. ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/labels.controller.ts#createLabel:projectId",
    route: "POST /projects/:projectId/labels",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/labels.controller.ts#updateLabel:labelId",
    route: "PATCH /labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên nhãn THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/labels.controller.ts#deleteLabel:labelId",
    route: "DELETE /labels/:labelId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM). ALLOW-204 trên nhãn THẬT (@HttpCode(204)). ${PIPED_500}`,
  },
  {
    key: "tasks/project-states.controller.ts#listStates:projectId",
    route: "GET /projects/:projectId/states",
    decision: "piped",
    before: BEFORE_500,
    reason: `Đọc cột pipeline của dự án. ALLOW-200 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/project-states.controller.ts#createState:projectId",
    route: "POST /projects/:projectId/states",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-201 trên dự án THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/project-states.controller.ts#updateState:stateId",
    route: "PATCH /states/:stateId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI. ALLOW-200 trên cột THẬT. ${PIPED_500}`,
  },
  {
    key: "tasks/project-states.controller.ts#deleteState:stateId",
    route: "DELETE /states/:stateId",
    decision: "piped",
    before: BEFORE_500,
    reason: `Route GHI (xoá MỀM, chặn nếu còn task tham chiếu). ALLOW-204 trên cột THẬT (@HttpCode(204)). ${PIPED_500}`,
  },
];

/**
 * **29 controller** mà sổ này TUYÊN BỐ PHỦ ĐỦ. Ratchet ca (5) dùng đúng danh sách này để chọn tập
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
 * ⟲ S10-FND-PARAMUUID-4 (đợt 3) thêm **8 controller / 36 site**. Cả 8 file đều có
 * `tổng id-like == số site đã đo` (2·2·2·2·12·9·3·3·1) ⇒ KHÔNG file nào mang site đã-có-pipe mà chưa
 * đo, nên tuyên bố "phủ đủ" ở đây là đúng nghĩa đen chứ không phải xấp xỉ.
 *
 * ⟲ S10-FND-PARAMUUID-5 (đợt 4, CUỐI trong phạm vi) thêm **5 controller / 75 site** — trọn module
 * `tasks/`. Cả 5 file đều có `tổng id-like == số site đã đo` (43·13·11·4·4 = 75) ⇒ KHÔNG file nào
 * mang site đã-có-pipe mà chưa đo. Và `tasks/` KHÔNG còn controller nào khác mang `@Param` id-like
 * (`task-attachments.controller.ts` có 0 site) ⇒ prefix `tasks/` vừa SẠCH vừa ĐO ĐỦ.
 *
 * CÒN NỢ sau đợt 4: **0 trong phạm vi.** Phần chưa vào danh sách này KHÔNG phải nợ:
 *   · `workflow/` **36** — code PARK chờ DỌN (`S10-CLEAN-WORKFLOWPARK-1`), CỐ Ý không đo, không vá;
 *   · `auth/` **1** — đã ký `skipped` ở đợt 1 (`revokeSession` đo được 404, vá sẽ đẻ oracle).
 * ⇒ trần ratchet còn **37 = 36 + 1**, KHÔNG phải 37 lỗi chờ vá.
 */
export const PARAM_UUID_MEASURED_FILES: readonly string[] = [
  // ── Đợt 1 — S10-FND-PARAMUUID-2 (32 site) ────────────────────────────────────────────────────
  "leave/leave.controller.ts",
  "attendance/attendance-adjustment.controller.ts",
  "attendance/remote-work-request.controller.ts",
  "attendance/attendance.controller.ts",
  "attendance/attendance-shift.controller.ts",
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
  // ── Đợt 3 — S10-FND-PARAMUUID-4 (36 site) ────────────────────────────────────────────────────
  "goals/goals.controller.ts",
  "goals/task-templates.controller.ts",
  "foundation/audit/audit.controller.ts",
  "foundation/holidays/holidays.controller.ts",
  "foundation/retention/retention.controller.ts",
  "foundation/sequences/sequence.controller.ts",
  "notifications/my-notifications.controller.ts",
  "notifications/notification-admin.controller.ts",
  "recycle-bin/recycle-bin.controller.ts",
  // ── Đợt 4 — S10-FND-PARAMUUID-5 (75 site) ────────────────────────────────────────────────────
  "tasks/tasks.controller.ts",
  "tasks/projects.controller.ts",
  "tasks/task-files.controller.ts",
  "tasks/labels.controller.ts",
  "tasks/project-states.controller.ts",
];

/**
 * SÀN chống sổ co về rỗng: **183** tham số đã đo — 30 của đợt 1 (29 `piped` + 1 `skipped`) + 42 của
 * đợt 2 + 36 của đợt 3 + 75 của đợt 4 (cả ba đợt sau đều 100% `piped`: mọi site đo được 500, KHÔNG
 * phản-ví-dụ). Xoá bớt dòng để "cho lưới xanh" sẽ ĐỎ ở đây trước khi kịp làm hỏng ca (5).
 *
 * ⚠️ **185 → 183 LÀ HẠ SÀN — LÝ DO BẰNG VĂN BẢN, đọc trước khi nghi ngờ.** Đợt 1 vốn 32 site; hai
 * site `approval/approval-inbox.controller.ts#{approve,reject}:id` KHÔNG bị "gỡ pipe cho xanh" mà
 * bị XOÁ CÙNG CẢ MODULE ở `S10-CLEAN-WORKFLOWCLUSTER-2` — không còn route để đo.
 * Cách phân biệt nếu sàn này lại tụt: sàn chỉ được hạ khi CONTROLLER biến mất khỏi cây mã (kiểm
 * bằng `PARAM_UUID_MEASURED_FILES` + `git log --diff-filter=D`). Site còn sống mà mất dòng verdict
 * là NỢ, cấm hạ sàn.
 */
export const PARAM_UUID_MEASURED_SIZE = 183;

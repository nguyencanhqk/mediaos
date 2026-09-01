import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import {
  PG_CHECK_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorField,
} from "../common/db-error";

/**
 * S13-PAYROLL-BE-1 — mã lỗi PAYROLL (SPEC-11 §12 · API-18 §6.5 · quy ước SPEC-01 §9). MỘT CHỖ duy
 * nhất định nghĩa mã + thông điệp — int-spec assert theo MÃ (`error.code`), không theo câu chữ.
 *
 * Hình dạng ném: `new XxxException({code, message, details})`; `details` là **MẢNG** `ErrorDetail
 * {field,message,rule}`, `kind` = phần tử `{field:'kind'}` (memory `error-details-must-be-errordetail-array`).
 *
 * ⚠️ **Thông điệp lỗi KHÔNG BAO GIỜ chứa số tiền** — kể cả trong `details` (API-18 §6.5).
 *
 * Khai đủ **001..017** để BE-2 không phải mở lại file đã qua FULL gate; 9 mã BE-2 chưa ném nằm trong
 * `PAYROLL_PENDING_BE2_ERRORS` (census assert tường minh, chống bẫy `coverage-high-but-error-code-untested`).
 */
export const PAYROLL_ERR_CODE = {
  /** 409 — chuyển trạng thái kỳ không hợp lệ theo FSM §13.1 (kể cả tới chính trạng thái hiện tại). */
  PERIOD_TRANSITION: "PAYROLL-ERR-001",
  /** 409 — kỳ công ATT chưa `locked`, hoặc kỳ lương chưa gắn `attendance_period_id`. */
  ATTENDANCE_NOT_READY: "PAYROLL-ERR-002",
  /** 409 — tính lại / điều chỉnh dòng khi kỳ đã ≥ `Approved` (snapshot đã đóng băng). */
  PERIOD_FROZEN: "PAYROLL-ERR-003",
  /** 409 — mở lại kỳ bị chặn (đã sinh phiếu, hoặc kỳ ở `Paid`/`Locked`). */
  REOPEN_BLOCKED: "PAYROLL-ERR-004",
  /** 409 — four-eyes: người duyệt trùng người gửi duyệt. */
  FOUR_EYES: "PAYROLL-ERR-005",
  /** 409 — sinh phiếu lương lần hai cho cùng (kỳ, nhân sự). */
  PAYSLIP_DUPLICATE: "PAYROLL-ERR-006",
  /** 409 — phát hành kỳ chưa sinh phiếu lương. */
  NO_PAYSLIP: "PAYROLL-ERR-007",
  /** 409 — tạo kỳ lương cho tháng đã có kỳ. */
  PERIOD_MONTH_EXISTS: "PAYROLL-ERR-008",
  /** 422 — không có nhân sự nào đủ điều kiện tính. */
  NO_ELIGIBLE_EMPLOYEE: "PAYROLL-ERR-009",
  /** 404 — sentinel not-found (không thuộc company / xoá mềm / ngoài data scope). */
  NOT_FOUND: "PAYROLL-ERR-010",
  /** 409 — thưởng/phạt: sửa hoặc quyết định hàng không còn `Pending`. */
  BONUS_NOT_PENDING: "PAYROLL-ERR-011",
  /** 409 — tự duyệt thưởng/phạt do chính mình tạo. */
  BONUS_SELF_APPROVAL: "PAYROLL-ERR-012",
  /** 409 — sửa/xoá mềm thưởng-phạt đã được gộp vào một kỳ lương. */
  BONUS_ALREADY_CONSUMED: "PAYROLL-ERR-013",
  /** 409 — hồ sơ lương: đã có phiên bản cùng `effective_date` cho nhân sự đó. */
  SALARY_EFFECTIVE_EXISTS: "PAYROLL-ERR-014",
  /** 409 — xác nhận phiếu chưa phát hành, hoặc xác nhận lần hai. */
  ACK_INVALID: "PAYROLL-ERR-015",
  /** 422 — export vượt trần 10.000 dòng. */
  EXPORT_LIMIT: "PAYROLL-ERR-016",
  /** 422 — không có người duyệt hợp lệ (chặn ở `submit`, không để kỳ kẹt ở `Reviewing`). */
  NO_ELIGIBLE_APPROVER: "PAYROLL-ERR-017",
} as const;

export type PayrollErrKey = keyof typeof PAYROLL_ERR_CODE;
export type PayrollErrCode = (typeof PAYROLL_ERR_CODE)[PayrollErrKey];

/**
 * **RỖNG từ `S13-PAYROLL-BE-2`** — cả 17 mã đều đã được ném và có ca test (route 007–018 · 029–033
 * lên dây ở BE-2). Hằng GIỮ LẠI, không xoá: census mã lỗi assert `PENDING ∪ tested === all` **VÀ**
 * `PENDING ∩ tested === ∅`, nên nó vẫn là cổng cho mã thứ 18 mọc lên sau này.
 *
 * ⚠️ Khi danh sách rỗng, neo chống-xanh-rỗng của CHÍNH nó biến mất ⇒ ca census phải neo bằng số
 * lượng mã (`Object.keys(PAYROLL_ERR_CODE).length`) thay thế. **Cấm hạ neo để lấy màu xanh.**
 */
export const PAYROLL_PENDING_BE2_ERRORS: readonly PayrollErrKey[] = [];

export const PAYROLL_ERR = {
  PERIOD_TRANSITION: (from: string, to: string) =>
    `PAYROLL-ERR-001: không thể chuyển kỳ lương từ "${from}" sang "${to}".`,
  /** Cùng mã 001 nhưng KHÁC nguyên nhân — xem `resolveActionTarget` (payroll-fsm.ts). */
  ACTION_NOT_APPLICABLE: (via: string, from: string) =>
    `PAYROLL-ERR-001: hành động "${via}" không áp dụng được khi kỳ lương đang ở "${from}".`,
  ATTENDANCE_NOT_LOCKED:
    "PAYROLL-ERR-002: kỳ công của tháng này chưa được khoá — chưa thể tính lương.",
  ATTENDANCE_PERIOD_MISSING:
    "PAYROLL-ERR-002: kỳ lương chưa gắn kỳ công — chọn kỳ công trước khi tính.",
  PERIOD_FROZEN: "PAYROLL-ERR-003: kỳ lương đã được duyệt — số liệu đã đóng băng, không sửa được.",
  REOPEN_PAYSLIP_GENERATED:
    "PAYROLL-ERR-004: kỳ lương đã sinh phiếu lương — không mở lại được (phiếu là bản ghi bất biến).",
  REOPEN_TERMINAL: (status: string) =>
    `PAYROLL-ERR-004: kỳ lương đang ở "${status}" — không mở lại được.`,
  FOUR_EYES: "PAYROLL-ERR-005: người duyệt phải khác người gửi duyệt.",
  PAYSLIP_DUPLICATE: "PAYROLL-ERR-006: phiếu lương của nhân sự này trong kỳ đã tồn tại.",
  NO_PAYSLIP: "PAYROLL-ERR-007: kỳ lương chưa sinh phiếu lương — chưa thể phát hành.",
  PERIOD_MONTH_EXISTS: "PAYROLL-ERR-008: tháng này đã có kỳ lương.",
  NO_ELIGIBLE_EMPLOYEE:
    "PAYROLL-ERR-009: không có nhân sự nào có hồ sơ lương hiệu lực trong kỳ — chưa thể tính.",
  NOT_FOUND: "PAYROLL-ERR-010: không tìm thấy dữ liệu tiền lương.",
  BONUS_NOT_PENDING: 'PAYROLL-ERR-011: chỉ sửa/quyết định được khoản đang "Chờ duyệt".',
  BONUS_SELF_APPROVAL: "PAYROLL-ERR-012: không thể tự duyệt khoản do chính mình tạo.",
  BONUS_ALREADY_CONSUMED:
    "PAYROLL-ERR-013: khoản này đã được gộp vào một kỳ lương — tạo khoản mới ở kỳ sau nếu cần điều chỉnh.",
  /** Nhánh RACE: trigger `enforce_bonus_penalty_freeze` bắt được nhưng service tiền-kiểm đã trượt. */
  BONUS_FROZEN_RACE:
    "PAYROLL-ERR-013: khoản thưởng/phạt vừa bị khoá bởi một thao tác khác — tải lại rồi thử lại.",
  SALARY_EFFECTIVE_EXISTS: "PAYROLL-ERR-014: nhân sự này đã có phiên bản lương cùng ngày hiệu lực.",
  ACK_NOT_PUBLISHED: "PAYROLL-ERR-015: phiếu lương chưa được phát hành.",
  ACK_ALREADY: "PAYROLL-ERR-015: bạn đã xác nhận phiếu lương này.",
  EXPORT_LIMIT: (total: number, max: number) =>
    `PAYROLL-ERR-016: kết quả ${total} dòng vượt trần ${max} — thu hẹp bộ lọc rồi xuất lại.`,
  /**
   * Vi phạm CHECK cặp vết duyệt (`approved_pair` · `published_pair` · `generated_pair` ·
   * `calculated_needs_attendance`) — CÙNG mã 001, khác nguyên nhân: chỉ xảy ra khi đường ghi trạng
   * thái có bug, và phải hiện thành 409 đọc được thay vì 500 vô danh (§8b).
   */
  TRAIL_PAIR_VIOLATION:
    "PAYROLL-ERR-001: trạng thái kỳ lương và vết duyệt không khớp nhau — tải lại kỳ rồi thử lại.",
  NO_ELIGIBLE_APPROVER:
    "PAYROLL-ERR-017: công ty chưa có người duyệt hợp lệ nào khác bạn — gán vai trò cho người tính lương hoặc thêm quản trị viên thứ hai.",
} as const;

/** `details.kind` = phần tử `{field:'kind'}`; các cặp phụ thêm sau — **không bao giờ là số tiền**. */
export function payrollDetails(
  kind: string,
  extra: Record<string, string | number | boolean | null | undefined> = {},
): ErrorDetail[] {
  const out: ErrorDetail[] = [{ field: "kind", message: kind, rule: "payroll" }];
  for (const [field, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue;
    out.push({ field, message: String(value), rule: "payroll" });
  }
  return out;
}

type Body = { code: PayrollErrCode; message: string; details?: ErrorDetail[] };
const body = (key: PayrollErrKey, message: string, details?: ErrorDetail[]): Body => ({
  code: PAYROLL_ERR_CODE[key],
  message,
  ...(details ? { details } : {}),
});

export const payrollConflict = (key: PayrollErrKey, message: string, details?: ErrorDetail[]) =>
  new ConflictException(body(key, message, details));

/** 422 — BE-1 chưa ném mã 422 nào (`009`/`016`/`017` là của BE-2); helper khai sẵn cùng bảng mã. */
export const payrollUnprocessable = (
  key: PayrollErrKey,
  message: string,
  details?: ErrorDetail[],
) => new UnprocessableEntityException(body(key, message, details));

/**
 * Sentinel **404 duy nhất** cho not-found / khác tenant / xoá mềm / ngoài data scope (SPEC-11 §12
 * mã 010) — **không 403**, để không lộ oracle "đối tượng có tồn tại hay không".
 */
export const payrollNotFound = () =>
  new NotFoundException(body("NOT_FOUND", PAYROLL_ERR.NOT_FOUND, payrollDetails("not-found")));

/**
 * Map lỗi PG → PAYROLL-ERR. Trả `null` khi ngoài phổ — caller `throw mapPayrollPgError(err) ?? err`.
 *
 * BỐN luật (ba luật đầu: plan §8, plan-review vòng 1 blocker #6; luật 4 thêm ở S13-PAYROLL-QA-1):
 *  1. `23505` → theo TÊN constraint. Bốn nhánh: `008` kỳ trùng tháng · `014` hồ sơ lương trùng ngày
 *     (BE-1) · `006` sinh phiếu hai lần · `015` xác nhận hai lần (BE-2, nối dây CÙNG ca test đi qua).
 *  2. `23514` **CÓ tên** → bản đồ SPEC-11 §12. `lines_adjustment_check` → `null` (rơi về 400 của tầng
 *     validate, đúng SPEC). `four_eyes_check` → **005** (chốt cuối cho RACE — service đã tiền-kiểm
 *     dưới row-lock). Bốn CHECK cặp vết duyệt (`approved_pair` · `published_pair` · `generated_pair` ·
 *     `calculated_needs_attendance`) → **409 mã 001 kèm `kind='trail-pair-violation'`**: mọi hành
 *     động FSM đã đi qua `applyTransitionTx` nên chúng chỉ nổ khi có BUG, mà bug ở vùng đỏ phải hiện
 *     thành lỗi đọc được — để rơi `null` là **500 vô danh** (§8b).
 *  3. `23514` **KHÔNG tên** → đây là trigger `enforce_bonus_penalty_freeze`: mig `0564` dùng
 *     `RAISE EXCEPTION … USING ERRCODE='check_violation'` **không kèm `USING CONSTRAINT`** ⇒
 *     `err.constraint` RỖNG, không phân biệt được nhánh (A)–(E). Vì vậy service **tiền-kiểm 011/013
 *     dưới `FOR UPDATE`**; nhánh này chỉ còn là chốt cuối cho RACE ⇒ map về **409 cố định**, tuyệt đối
 *     không để rơi thành 500 ở vùng đỏ.
 */
export function mapPayrollPgError(err: unknown): Error | null {
  const code = pgErrorCode(err);
  if (code === PG_UNIQUE_VIOLATION) {
    const c = pgErrorField(err, "constraint") ?? "";
    if (c.includes("payroll_periods_company_month_uq")) {
      return payrollConflict(
        "PERIOD_MONTH_EXISTS",
        PAYROLL_ERR.PERIOD_MONTH_EXISTS,
        payrollDetails("period-month-exists"),
      );
    }
    if (c.includes("salary_profiles_company_user_effective_uq")) {
      return payrollConflict(
        "SALARY_EFFECTIVE_EXISTS",
        PAYROLL_ERR.SALARY_EFFECTIVE_EXISTS,
        payrollDetails("effective-date-exists"),
      );
    }
    // S13-PAYROLL-BE-2 nối dây hai nhánh dưới CÙNG với ca test đi qua chúng (BE-1 cố ý để trống vì
    // không route nào của nó ghi vào hai bảng này — nhánh map khi đó là code chết).
    if (c.includes("payslips_period_user_uq")) {
      return payrollConflict(
        "PAYSLIP_DUPLICATE",
        PAYROLL_ERR.PAYSLIP_DUPLICATE,
        payrollDetails("payslip-duplicate"),
      );
    }
    if (c.includes("payslip_acknowledgements_payslip_user_uq")) {
      return payrollConflict(
        "ACK_INVALID",
        PAYROLL_ERR.ACK_ALREADY,
        payrollDetails("already-acknowledged"),
      );
    }
    return null;
  }
  if (code === PG_CHECK_VIOLATION) {
    const c = pgErrorField(err, "constraint") ?? "";
    // `payroll_period_lines_adjustment_check` → để `null`: SPEC-11 §12 xếp nó về 400 VALIDATION-ERR-001
    // (Zod đã mirror ĐÚNG BẰNG, nên tới được đây nghĩa là payload lách qua tầng validate).
    if (c.includes("payroll_period_lines_adjustment_check")) return null;
    // Four-eyes — chốt cuối ở DB cho RACE: service đã tiền-kiểm `submitted_by <> actor` dưới row-lock,
    // nên tới được đây là hai lượt duyệt chen nhau. 409, KHÔNG 500 (SPEC-11 §12 mã 005).
    if (c.includes("payroll_periods_four_eyes_check")) {
      return payrollConflict("FOUR_EYES", PAYROLL_ERR.FOUR_EYES, payrollDetails("four-eyes"));
    }
    // 🩹§8b — BỐN CHECK cặp vết duyệt còn lại. Trước BE-2 chúng rơi `null` ⇒ **500 ở vùng đỏ**.
    // Mọi hành động FSM đã đi qua `applyTransitionTx` (bảng `TRAIL_RESET`), nên bốn cái này chỉ nổ khi
    // có BUG — nhưng bug phải hiện thành 409 đọc được, không phải 500 vô danh.
    if (
      c.includes("payroll_periods_approved_pair_check") ||
      c.includes("payroll_periods_published_pair_check") ||
      c.includes("payroll_periods_generated_pair_check") ||
      c.includes("payroll_periods_calculated_needs_attendance_check")
    ) {
      return payrollConflict(
        "PERIOD_TRANSITION",
        PAYROLL_ERR.TRAIL_PAIR_VIOLATION,
        payrollDetails("trail-pair-violation", { constraint: c }),
      );
    }
    if (c === "") {
      // Không tên ⇒ trigger `enforce_bonus_penalty_freeze` (luật 3 ở JSDoc trên).
      return payrollConflict(
        "BONUS_ALREADY_CONSUMED",
        PAYROLL_ERR.BONUS_FROZEN_RACE,
        payrollDetails("bonus-frozen-race"),
      );
    }
    return null;
  }
  // 🩹 Luật 4 — thêm ở `S13-PAYROLL-QA-1` (đo 2026-09-01). `23503` TRƯỚC đó không có nhánh nào ⇒
  // `POST /salary-profiles` và `POST /bonus-penalties` với `userId` KHÔNG tồn tại (hoặc thuộc tenant
  // khác) rơi thẳng thành **500 SYSTEM-ERR-001** — đúng thứ §8b của file này cấm. Kịch bản thật, không
  // phải trò cạy: người dùng bị xoá giữa lúc mở picker và lúc bấm Lưu.
  //
  // Map theo TÊN constraint (luật 1), KHÔNG map trọn `23503`: FK nội bộ vỡ (`company_id`, `created_by`,
  // `payroll_period_id`…) là BUG của server, che nó bằng 404 sẽ giấu lỗi thật. Chỉ hai FK trỏ tới
  // NHÂN SỰ ĐƯỢC CHỌN mới là "đầu vào người dùng sai" ⇒ 404 sentinel `PAYROLL-ERR-010`.
  //
  // ⚠️ Hai nguồn phải CÙNG một phản hồi: `*_user_id_fkey` (không tồn tại) và `*_user_id_company_fk`
  // (tồn tại nhưng của tenant KHÁC). Trả khác nhau là dựng oracle "user này có thật ở đâu đó" — cùng
  // lỗ mà sentinel 404 của module sinh ra để bịt.
  if (code === PG_FK_VIOLATION) {
    const c = pgErrorField(err, "constraint") ?? "";
    if (
      c.includes("salary_profiles_user_id") ||
      c.includes("bonus_penalties_user_id") ||
      c.includes("payslips_user_id")
    ) {
      return payrollNotFound();
    }
    return null;
  }
  return null;
}

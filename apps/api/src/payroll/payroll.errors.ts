import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import {
  PG_CHECK_VIOLATION,
  PG_EXCLUSION_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorField,
} from "../common/db-error";
import type { FormulaError, FormulaErrorCode } from "./formula/formula.errors";
import { FORMULA_MAX_LENGTH } from "./formula/formula.limits";

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
 *
 * 🔻 **S15-PAYROLL-BE-2** thêm 6 mã track B (019 · 020 · 022 · 023 · 024 · 033). Luật ném `kind` của track B:
 *  - kind của MÁY CÔNG THỨC sống trong bảng ĐÓNG `FORMULA_ERROR_KINDS` (`formula/formula.errors.ts`) và đi qua
 *    `formulaErrorToHttp` — census mã lỗi đọc bảng đó như một nguồn ném;
 *  - kind cấp SERVICE BẮT BUỘC là literal `payrollDetails("…")` TẠI CHỖ NÉM (không helper nhận kind biến) — census
 *    bắt kind bằng regex trên literal, kind dựng động là vùng mù (`refactor-to-helper-blinds-syntax-census`).
 */
export const PAYROLL_ERR_CODE = {
  /** 409 — chuyển trạng thái kỳ không hợp lệ theo FSM §13.1 (kể cả tới chính trạng thái hiện tại). */
  PERIOD_TRANSITION: "PAYROLL-ERR-001",
  /** 409 — kỳ công ATT chưa `locked`, hoặc kỳ lương chưa gắn `attendance_period_id`. */
  ATTENDANCE_NOT_READY: "PAYROLL-ERR-002",
  /** 409 — tính lại / điều chỉnh dòng khi kỳ đã ≥ `Approved` (snapshot đã đóng băng). */
  PERIOD_FROZEN: "PAYROLL-ERR-003",
  /** 409 — mở lại kỳ bị chặn (đã sinh phiếu, hoặc kỳ ở `Published`/`Paid`/`Locked`). */
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
  /**
   * 422 — **S15-PAYROLL-BE-1**. SPEC-11 §12.1 cấp 018 cho "tham chiếu không hợp lệ lúc LƯU". BE-1 dùng
   * nó cho `salary_profile_items[].componentCode` với **`kind` RIÊNG**, KHÔNG mượn `formula-unknown-ref`:
   * §12.1 chia mã theo THỜI ĐIỂM và `:709` nói rõ mục đích là để FE biết mở **editor công thức** hay mở
   * **hồ sơ lương**. Hai `kind` của BE-1 — `profile-item-unknown-component` · `profile-item-wrong-type`.
   * BE-2 thêm các `kind` công thức thật (`formula-syntax`/`formula-unknown-ref`/…) + kind cấu trúc mẫu.
   */
  FORMULA_INVALID: "PAYROLL-ERR-018",
  /** 422 — **S15-PAYROLL-BE-2**. Vòng phụ thuộc giữa các thành phần (`formula-cycle`, `details.cycle` đầy đủ). */
  FORMULA_CYCLE: "PAYROLL-ERR-019",
  /** 422 — **S15-PAYROLL-BE-2**. Lỗi lúc TÍNH: vượt ngân sách node · chia cho 0 · tràn `numeric(18,2)`. */
  FORMULA_EVAL: "PAYROLL-ERR-020",
  /**
   * 422 — **S15-PAYROLL-BE-3**. Gross-up NET không hội tụ (`grossup-not-converged`, `details` = userId · iterations ·
   * reason — KHÔNG sai số còn lại vì đó là tiền, plan §3.6). Kỳ KHÔNG chuyển trạng thái, 0 dòng được ghi.
   */
  GROSSUP_NOT_CONVERGED: "PAYROLL-ERR-021",
  /** 422 — **S15-PAYROLL-BE-2**. Bản tỉ lệ luật định thiếu/không liên tục bậc TNCN (`statutory-rate-incomplete`). */
  STATUTORY_RATE_INVALID: "PAYROLL-ERR-022",
  /**
   * 409 — **S15-PAYROLL-BE-2**. Mẫu bảng lương: trùng `code` (`template-code-exists`). Ba kind gắn với KỲ
   * (`template-locked` · `template-missing` · `template-inactive`) và `template-in-use` là việc của BE-3/BE-4 —
   * cần `payroll_periods.template_id` của DB-2.
   */
  TEMPLATE_CONFLICT: "PAYROLL-ERR-023",
  /**
   * 409 — **S15-PAYROLL-BE-2**. Thành phần lương: hàng hệ thống đóng băng (`system-component-immutable`) · đang
   * được mẫu dùng (`component-in-use`) · trùng mã (`component-code-exists`) · mã thuộc không gian tên hệ thống
   * (`component-code-reserved`).
   */
  COMPONENT_CONFLICT: "PAYROLL-ERR-024",
  // ── S15-PAYROLL-BE-4 (track C — SPEC-11 §12.1 hàng 025..030) ──
  /**
   * 409 — tạm ứng: sửa/quyết định hàng không còn `Pending` (`advance-not-pending`) · đã khấu trừ vào kỳ
   * (`advance-already-deducted`) · **tự duyệt** — người TẠO hoặc người THỤ HƯỞNG (`self-approval`, plan-review B2;
   * CHECK `payroll_advances_four_eyes_check` chỉ soi `created_by` nên vế thụ hưởng CHỈ có ở service).
   */
  ADVANCE_CONFLICT: "PAYROLL-ERR-025",
  /** 409 — gắn/duyệt tạm ứng vào kỳ đã đóng băng (`advance-period-frozen`, D-3) + tag `period-frozen` của T3. */
  ADVANCE_PERIOD_FROZEN: "PAYROLL-ERR-026",
  /**
   * 409 — đợt chi trả: `period-not-published` · `batch-incomplete` · `batch-already-completed` · `payee-already-in-batch`
   * (chốt cuối `payroll_payment_lines_payslip_uq` TOÀN công ty) · `batch-code-exists` · `batch-four-eyes` ·
   * `payee-no-bank-account` · `line-already-paid` (B1).
   */
  PAYMENT_BATCH_CONFLICT: "PAYROLL-ERR-027",
  /** 409 — hoàn tất đợt RỖNG (0 dòng sống) — đường phát DUY NHẤT của 028 (`batch-empty`). */
  BATCH_EMPTY: "PAYROLL-ERR-028",
  /** 409 — ngân sách trùng `(năm, đơn vị)` — chốt cuối `payroll_budgets_year_unit_uq` (`budget-exists`). */
  BUDGET_EXISTS: "PAYROLL-ERR-029",
  /** 422 — import: sai khuôn (`import-invalid`) · > 5.000 dòng (`import-too-large`) · mã NV lạ (`import-unknown-user`). */
  IMPORT_INVALID: "PAYROLL-ERR-030",
  /** 422 — **S15-PAYROLL-BE-5**. Báo cáo 081/082 > 50.000 dòng theo bộ lọc (`report-too-large`); PDF hàng loạt = BE-5B. */
  REPORT_TOO_LARGE: "PAYROLL-ERR-031",
  /**
   * 409 — **S15-PAYROLL-BE-1**. Hai bản ghi người phụ thuộc **chồng lấp khoảng hiệu lực** cho cùng một
   * NPT. Chốt cuối `EXCLUDE USING gist` ở DB (`payroll_dependents_no_overlap_excl`) ném **`23P01`**,
   * KHÔNG phải `23505` ⇒ map race thành 409, không 500 (SPEC-11 §12.1 mã 032).
   */
  DEPENDENT_OVERLAP: "PAYROLL-ERR-032",
  /** 409 — **S15-PAYROLL-BE-2**. Bản tỉ lệ luật định: trùng `effective_from` · đã có kỳ lương dùng (`rate-in-use`). */
  STATUTORY_RATE_CONFLICT: "PAYROLL-ERR-033",
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
  /**
   * S15-PAYROLL-BE-1 — 🔻 **nợ từ DB-1**. Hồ sơ lương DI SẢN mang mã `PC_nnn` do backfill mig `0570`
   * sinh (DB-13 §12.2.a), NGOÀI catalog `salary_components` vì lúc backfill chạy thì catalog chưa tồn
   * tại (nó seed RUNTIME). Đường ĐỌC trả nguyên kèm `note`; đường GHI từ chối tại đây và **hướng người
   * dùng chọn mã catalog thật** — thông điệp phải nói được PHẢI LÀM GÌ, không chỉ "sai".
   */
  PROFILE_ITEM_UNKNOWN_COMPONENT: (codes: string) =>
    `PAYROLL-ERR-018: mã thành phần lương không có trong danh mục: ${codes}. Chọn lại mã từ danh mục thành phần lương của công ty (hồ sơ cũ chuyển đổi từ bản trước có thể mang mã tạm cần thay).`,
  /**
   * Thành phần CÓ trong catalog nhưng SAI LOẠI. Đây là chốt chặn một lớp lỗi TIỀN thật, không phải
   * khắt khe thừa: `salary_profiles.allowances` là đầu vào tính lương v1 và `payroll-calc.repository.ts`
   * cộng MỌI phần tử của nó vào `gross` — nhận một thành phần `tax`/`deduction` vào `items[]` là
   * **CỘNG** tiền thuế cho nhân viên thay vì trừ.
   */
  PROFILE_ITEM_WRONG_TYPE: (codes: string) =>
    `PAYROLL-ERR-018: mã thành phần lương không thuộc loại cấp theo hồ sơ: ${codes}. Chỉ thành phần có "giá trị theo hồ sơ lương" mới đặt được định mức ở đây.`,
  DEPENDENT_OVERLAP:
    "PAYROLL-ERR-032: người phụ thuộc này đã có bản ghi trùng khoảng thời gian hiệu lực — chỉnh lại ngày bắt đầu/kết thúc để hai khoảng không chồng nhau.",
  /**
   * Cặp ngân hàng KHÔNG đủ sau khi MERGE (039 là upsert từng phần). Thông điệp **không bao giờ** nhắc
   * lại số tài khoản — đây đúng là đường mà security review bắt được rò PII qua message lỗi.
   */
  BANK_PAIR_INCOMPLETE:
    "PAYROLL-ERR-018: có số tài khoản thì phải có CẢ tên ngân hàng lẫn tên chủ tài khoản — nếu muốn xoá tài khoản, gửi số tài khoản rỗng (null) cùng lượt.",
  /** Mã 014 — `kind` thứ HAI (SPEC-11 §12 hàng 014): hai dòng `items[]` cùng `component_code`. */
  PROFILE_ITEM_DUPLICATE:
    "PAYROLL-ERR-014: một thành phần lương chỉ được khai một dòng trong cùng phiên bản hồ sơ.",
  // ── S15-PAYROLL-BE-2 (track B) — thông điệp nói được PHẢI LÀM GÌ; KHÔNG số tiền ──
  COMPONENT_VALUE_PAIR:
    "PAYROLL-ERR-018: loại giá trị không khớp dữ liệu — «công thức» cần công thức, «cố định» cần số tiền, «theo hồ sơ lương» không nhận cả hai.",
  TEMPLATE_SCOPE_PAIR:
    "PAYROLL-ERR-018: mẫu theo đơn vị phải chọn đơn vị; mẫu toàn công ty không gắn đơn vị.",
  TEMPLATE_TOO_MANY_COMPONENTS: (max: number) =>
    `PAYROLL-ERR-018: một mẫu bảng lương có tối đa ${max} thành phần.`,
  TEMPLATE_COMPONENT_DUPLICATE:
    "PAYROLL-ERR-018: một thành phần chỉ được đặt một lần trong mẫu bảng lương.",
  TEMPLATE_COMPONENT_UNKNOWN:
    "PAYROLL-ERR-018: có thành phần không tồn tại hoặc đã ngưng dùng trong danh mục — tải lại danh mục rồi chọn lại.",
  FORMULA_OVERRIDE_NOT_ALLOWED: (codes: string) =>
    `PAYROLL-ERR-018: không ghi đè được công thức cho thành phần tổng hợp hoặc lấy giá trị theo hồ sơ lương: ${codes}.`,
  FORMULA_REF_NOT_IN_TEMPLATE: (template: string, ref: string) =>
    `PAYROLL-ERR-018: mẫu "${template}" không chứa thành phần "${ref}" mà công thức mới tham chiếu — thêm thành phần đó vào mẫu trước.`,
  TEMPLATE_CODE_EXISTS: "PAYROLL-ERR-023: mã mẫu bảng lương đã tồn tại.",
  COMPONENT_SYSTEM_IMMUTABLE:
    "PAYROLL-ERR-024: thành phần lương hệ thống chỉ đổi được tên hiển thị và thứ tự — muốn đổi cách tính, ghi đè công thức trong mẫu bảng lương.",
  COMPONENT_IN_USE: (templates: string) =>
    `PAYROLL-ERR-024: thành phần lương đang được mẫu bảng lương sử dụng (${templates}) — gỡ khỏi mẫu trước khi ngưng dùng hoặc xoá.`,
  COMPONENT_CODE_EXISTS: "PAYROLL-ERR-024: mã thành phần lương đã tồn tại.",
  FORMULA_TOO_LONG_STORED: `PAYROLL-ERR-018: công thức dài quá ${FORMULA_MAX_LENGTH} ký tự.`,
  COMPONENT_CODE_RESERVED: (code: string) =>
    `PAYROLL-ERR-024: mã "${code}" thuộc không gian tên hệ thống (biến hệ thống, hằng luật định, tên hàm hoặc thành phần hệ thống) — chọn mã khác.`,
  RATE_EFFECTIVE_EXISTS: "PAYROLL-ERR-033: đã có bản tỉ lệ luật định cùng ngày hiệu lực.",
  RATE_IN_USE:
    "PAYROLL-ERR-033: bản tỉ lệ này đã được kỳ lương dùng — tạo bản mới với ngày hiệu lực mới thay vì sửa tại chỗ.",
  // ── S15-PAYROLL-BE-3 (máy tính lương v2) — thông điệp nói được PHẢI LÀM GÌ; KHÔNG số tiền ──
  TEMPLATE_MISSING:
    "PAYROLL-ERR-023: kỳ lương chưa gắn mẫu bảng lương (hoặc mẫu đã bị xoá) — chọn mẫu cho kỳ trước khi tính.",
  TEMPLATE_INACTIVE:
    "PAYROLL-ERR-023: mẫu bảng lương của kỳ đang ngưng dùng — bật lại mẫu hoặc chọn mẫu khác cho kỳ.",
  TEMPLATE_LOCKED:
    "PAYROLL-ERR-023: kỳ lương đã tính — chỉ đổi được mẫu bảng lương khi kỳ còn ở Nháp hoặc Thu thập dữ liệu.",
  TEMPLATE_SCOPE_UNSUPPORTED:
    "PAYROLL-ERR-023: mẫu bảng lương theo đơn vị chưa gắn được vào kỳ lương (kỳ tính cho cả công ty) — chọn mẫu toàn công ty.",
  SYSTEM_COMPONENT_DRIFT: (codes: string) =>
    `PAYROLL-ERR-018: thành phần lương hệ thống bị sửa lệch cách tính chuẩn (${codes}) — liên hệ quản trị hệ thống, không tính lương trên dữ liệu này.`,
  TEMPLATE_INPUT_MISSING: (codes: string) =>
    `PAYROLL-ERR-018: mẫu bảng lương thiếu thành phần hệ thống bắt buộc hoặc đang ghi đè công thức của chúng (${codes}) — thưởng, phạt, tạm ứng và nghỉ không lương sẽ không vào lương nếu thiếu.`,
  STATUTORY_RATE_MISSING:
    "PAYROLL-ERR-022: chưa có bản tỉ lệ luật định hiệu lực tại ngày cuối kỳ — tạo bản tỉ lệ ở Thiết lập lương trước khi tính.",
  GROSSUP_NOT_CONVERGED:
    "PAYROLL-ERR-021: không quy đổi được lương NET sang GROSS cho một nhân sự — kiểm tra công thức tuỳ biến của mẫu và hồ sơ lương của người đó.",
  // ── S15-PAYROLL-BE-4 (track C) — thông điệp nói được PHẢI LÀM GÌ; KHÔNG số tiền, KHÔNG số tài khoản ──
  ADVANCE_NOT_PENDING: 'PAYROLL-ERR-025: chỉ sửa/quyết định được tạm ứng đang "Chờ duyệt".',
  ADVANCE_ALREADY_DEDUCTED:
    "PAYROLL-ERR-025: tạm ứng này đã được khấu trừ vào một kỳ lương — không sửa/xoá được; tạo đề nghị mới nếu cần.",
  ADVANCE_SELF_APPROVAL:
    "PAYROLL-ERR-025: không thể tự duyệt tạm ứng do chính mình tạo hoặc của chính mình — cần một người duyệt khác.",
  ADVANCE_FROZEN_RACE:
    "PAYROLL-ERR-025: tạm ứng vừa bị thay đổi bởi một thao tác khác — tải lại rồi thử lại.",
  ADVANCE_PERIOD_FROZEN:
    "PAYROLL-ERR-026: kỳ lương chỉ định đã tính hoặc đã duyệt — chọn kỳ khấu trừ khác hoặc mở lại kỳ trước khi thêm tạm ứng.",
  PERIOD_NOT_PUBLISHED: "PAYROLL-ERR-027: chỉ lập đợt chi trả từ kỳ lương đã phát hành phiếu.",
  BATCH_INCOMPLETE:
    "PAYROLL-ERR-027: đợt còn dòng chưa đánh dấu đã chi — đánh dấu từng dòng hoặc gửi confirmAllPaid khi hoàn tất.",
  BATCH_ALREADY_COMPLETED:
    "PAYROLL-ERR-027: đợt chi trả đã hoàn tất — không sửa/hoàn tất lại được.",
  PAYEE_ALREADY_IN_BATCH:
    "PAYROLL-ERR-027: phiếu lương của nhân sự này đã nằm ở một đợt chi trả khác — gỡ khỏi đợt đó trước.",
  BATCH_CODE_EXISTS:
    "PAYROLL-ERR-027: mã đợt chi trả đã tồn tại — chọn mã khác hoặc để trống để hệ thống tự sinh.",
  BATCH_FOUR_EYES:
    "PAYROLL-ERR-027: người hoàn tất đợt phải khác người lập đợt — cần một người khác giữ quyền quản lý đợt chi trả xác nhận.",
  PAYEE_NO_BANK_ACCOUNT:
    "PAYROLL-ERR-027: có nhân sự chưa khai số tài khoản ngân hàng — khai ở Nhân sự hưởng lương hoặc lập đợt tiền mặt cho họ.",
  LINE_ALREADY_PAID:
    "PAYROLL-ERR-027: dòng đã đánh dấu đã chi thì không gỡ khỏi đợt được — không có đường bỏ đánh dấu ở phiên bản này.",
  BATCH_EMPTY: "PAYROLL-ERR-028: đợt chi trả không còn dòng nào — thêm dòng trước khi hoàn tất.",
  BUDGET_EXISTS:
    "PAYROLL-ERR-029: đã có ngân sách cho năm và đơn vị này — sửa hàng đó thay vì tạo mới.",
  IMPORT_INVALID:
    "PAYROLL-ERR-030: tệp import không đúng khuôn — tải tệp mẫu, giữ đúng thứ tự cột rồi nạp lại. Không dòng nào được ghi.",
  IMPORT_TOO_LARGE: (max: number) =>
    `PAYROLL-ERR-030: tệp vượt trần ${max} dòng — tách tệp rồi nạp từng phần.`,
  IMPORT_UNKNOWN_USER:
    "PAYROLL-ERR-030: có dòng mang mã nhân viên không có trong công ty — sửa mã hoặc bỏ dòng. Không dòng nào được ghi.",
  REPORT_TOO_LARGE: (total: number, max: number) =>
    `PAYROLL-ERR-031: báo cáo có ${total} dòng, vượt trần ${max} — thu hẹp khoảng tháng hoặc lọc theo đơn vị.`,
  NO_ELIGIBLE_COMPLETER:
    "PAYROLL-ERR-017: công ty chưa có người nào khác bạn giữ quyền quản lý đợt chi trả — đợt lập ra sẽ không hoàn tất được (bốn mắt). Cấp quyền cho người thứ hai trước.",
  TEMPLATE_IN_USE: (periods: number) =>
    `PAYROLL-ERR-023: mẫu bảng lương đang được ${periods} kỳ lương sử dụng — đổi mẫu cho các kỳ đó trước khi ngưng dùng hoặc xoá.`,
  PERIOD_FROZEN_IMPORT:
    "PAYROLL-ERR-003: kỳ lương đã gửi duyệt hoặc đã duyệt — khoản nhập thêm sẽ không được gộp; nhập vào kỳ sau hoặc mở lại kỳ.",
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
 * S15-PAYROLL-BE-4 (plan-review B4) — **400 `VALIDATION-ERR-001`, lưới CUỐI** cho ba CHECK track C mà Zod đã mirror
 * ĐÚNG BẰNG (`payroll_payment_batches_completed_pair_check` · `payroll_payment_lines_bank_pair_check` ·
 * `payroll_advances_deducted_bound_check`): tới được đây là payload lách tầng validate hoặc đường ghi nội bộ có bug —
 * phải hiện thành 400 đọc được (SPEC-11 §12.1 bảng), KHÔNG 500 vùng đỏ. `constraint` đi vào `details` để truy vết;
 * message KHÔNG mang tham số câu SQL (số tài khoản có thể nằm trong đó — security DB-2 MEDIUM-2).
 */
export const payrollBadRequest = (constraint: string) =>
  new BadRequestException({
    code: "VALIDATION-ERR-001",
    message: "Dữ liệu không hợp lệ",
    details: [
      { field: "constraint", message: constraint, rule: "payroll" },
    ] satisfies ErrorDetail[],
  });

/**
 * S15-PAYROLL-BE-2 — mã của máy công thức → key. Bảng ĐÓNG theo `FormulaErrorCode` (trình biên dịch ép đủ nhánh).
 * Census mã lỗi đọc các literal key dưới đây như bằng chứng «mã được ném».
 */
const FORMULA_CODE_TO_KEY: Readonly<Record<FormulaErrorCode, PayrollErrKey>> = {
  "PAYROLL-ERR-018": "FORMULA_INVALID",
  "PAYROLL-ERR-019": "FORMULA_CYCLE",
  "PAYROLL-ERR-020": "FORMULA_EVAL",
  "PAYROLL-ERR-021": "GROSSUP_NOT_CONVERGED",
  "PAYROLL-ERR-022": "STATUTORY_RATE_INVALID",
};

/**
 * `FormulaError` (engine thuần, không Nest) → 422 PAYROLL-ERR. `kind` giữ NGUYÊN từ engine (bảng đóng
 * `FORMULA_ERROR_KINDS`); `details` chỉ vị trí/mã/chu trình/trần — engine không bao giờ đặt số tiền vào đó.
 */
export function formulaErrorToHttp(
  err: FormulaError,
  extra: Record<string, string> = {},
): UnprocessableEntityException {
  const d = err.details;
  return payrollUnprocessable(
    FORMULA_CODE_TO_KEY[err.code],
    `${err.code}: ${err.message}`,
    payrollDetails(err.kind, {
      ...extra,
      pos: d.pos,
      component: d.component,
      ref: d.ref,
      func: d.func,
      cycle: d.cycle?.join(" → "),
      limit: d.limit,
      pass: d.pass,
      reason: d.reason,
      missing: d.missing?.join(","),
      iterations: d.iterations,
    }),
  );
}

/**
 * Message của NODE mang `code` trong chuỗi `.cause` — KHÔNG phải `DrizzleQueryError.message` (lớp ngoài là
 * «Failed query: … params: …», có thể chở tham số). Dùng để phân biệt trigger `RAISE EXCEPTION` không kèm tên
 * constraint.
 */
function pgNodeMessage(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) break;
    const node = current as Record<string, unknown>;
    if (typeof node["code"] === "string") {
      return typeof node["message"] === "string" ? node["message"] : "";
    }
    current = node["cause"];
  }
  return "";
}

/** Bóc `<trigger>:<tag>:` ở đầu message trigger track C (mig 0572). Không khớp ⇒ `null`. */
const TRIGGER_TAG_RE = /^(\w+):([a-z-]+):/;

/**
 * S15-PAYROLL-BE-4 — ba trigger track C (mig `0572`) ném `23514` KHÔNG tên constraint, message mở đầu bằng
 * `<trigger>:<tag>:`. Map theo TAG (luật 3 mở rộng). Tag KHÔNG có trong bảng ⇒ `null` = **500 CÓ CHỦ ĐÍCH** (plan
 * §3.6): T1 `has-active-lines` (không có route xoá đợt) · T2 `not-found`/`cross-user`/`cross-period` · T3 `not-found` —
 * service PHẢI chặn trước, tới DB là bug, che bằng 4xx là giấu bug. Census QA ghim tập tag đã map ĐẲNG THỨC.
 */
function mapPayrollTrackCTag(message: string): Error | null {
  const m = TRIGGER_TAG_RE.exec(message);
  if (!m) return null;
  const [, trigger, tag] = m;
  if (trigger === "payroll_payment_batch_freeze") {
    // `insert-completed` · `period-immutable` · `frozen` — đợt `Completed` là TERMINAL / kỳ của đợt bất biến.
    if (tag === "insert-completed" || tag === "period-immutable" || tag === "frozen") {
      return payrollConflict(
        "PAYMENT_BATCH_CONFLICT",
        PAYROLL_ERR.BATCH_ALREADY_COMPLETED,
        payrollDetails("batch-already-completed", { trigger, tag }),
      );
    }
    return null;
  }
  if (trigger === "payroll_payment_line_guard") {
    if (tag === "frozen" || tag === "insert-into-completed" || tag === "move-to-completed") {
      return payrollConflict(
        "PAYMENT_BATCH_CONFLICT",
        PAYROLL_ERR.BATCH_ALREADY_COMPLETED,
        payrollDetails("batch-already-completed", { trigger, tag }),
      );
    }
    return null;
  }
  if (trigger === "payroll_advance_freeze_guard") {
    if (tag === "frozen" || tag === "status-terminal" || tag === "insert-shape") {
      return payrollConflict(
        "ADVANCE_CONFLICT",
        PAYROLL_ERR.ADVANCE_FROZEN_RACE,
        payrollDetails("advance-not-pending", { trigger, tag }),
      );
    }
    if (tag === "rebind") {
      return payrollConflict(
        "ADVANCE_CONFLICT",
        PAYROLL_ERR.ADVANCE_ALREADY_DEDUCTED,
        payrollDetails("advance-already-deducted", { trigger, tag }),
      );
    }
    if (tag === "period-frozen") {
      return payrollConflict(
        "ADVANCE_PERIOD_FROZEN",
        PAYROLL_ERR.ADVANCE_PERIOD_FROZEN,
        payrollDetails("advance-period-frozen", { trigger, tag }),
      );
    }
    return null;
  }
  return null;
}

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
 *  3. `23514` **KHÔNG tên** → một trigger `RAISE EXCEPTION … USING ERRCODE='check_violation'` không kèm
 *     `USING CONSTRAINT`. 🔻 **S15-PAYROLL-BE-2 (plan-review M2/MF9):** trước đó mọi 23514 rỗng đều bị gắn
 *     thành 013 «thưởng/phạt» — kể cả trigger `salary_component_system_freeze` của mig `0570`. Nay khớp
 *     **DƯƠNG** theo tiền tố message: `bonus_penalty_freeze_guard:` (mig `0564`) ⇒ 013 · `salary_components:`
 *     (mig `0570`) ⇒ 024 · còn lại ⇒ `null` — trigger tương lai (vd freeze của DB-2) không bị dán nhầm 013.
 *     Service **tiền-kiểm dưới `FOR UPDATE`**; nhánh này chỉ còn là chốt cuối cho RACE.
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
    // S15-PAYROLL-BE-1 — hai dòng `items[]` cùng `component_code` trong MỘT phiên bản. SPEC-11 §12
    // hàng 014 chốt: cấp `kind` MỚI trên mã CŨ (cùng đối tượng nghiệp vụ), không cấp mã mới — và một
    // unique KHÔNG có `kind` là "500 trá hình".
    if (c.includes("salary_profile_items_profile_component_uq")) {
      return payrollConflict(
        "SALARY_EFFECTIVE_EXISTS",
        PAYROLL_ERR.PROFILE_ITEM_DUPLICATE,
        payrollDetails("profile-item-duplicate"),
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
    // ── S15-PAYROLL-BE-2 — ba unique partial của track B (race sau tiền-kiểm, hoặc không tiền-kiểm) ──
    if (c.includes("salary_components_company_code_uq")) {
      return payrollConflict(
        "COMPONENT_CONFLICT",
        PAYROLL_ERR.COMPONENT_CODE_EXISTS,
        payrollDetails("component-code-exists"),
      );
    }
    if (c.includes("payroll_templates_company_code_uq")) {
      return payrollConflict(
        "TEMPLATE_CONFLICT",
        PAYROLL_ERR.TEMPLATE_CODE_EXISTS,
        payrollDetails("template-code-exists"),
      );
    }
    if (c.includes("payroll_statutory_rates_company_effective_uq")) {
      return payrollConflict(
        "STATUTORY_RATE_CONFLICT",
        PAYROLL_ERR.RATE_EFFECTIVE_EXISTS,
        payrollDetails("rate-effective-date-exists"),
      );
    }
    // ── S15-PAYROLL-BE-4 — ba UNIQUE track C (mig 0572). `payslip_uq` (TOÀN công ty — chốt cuối chống trả HAI LẦN)
    //    và `batch_user_uq` (cùng đợt) CÙNG kind `payee-already-in-batch` (SPEC-11 §12.1 hàng 027). ──
    if (
      c.includes("payroll_payment_lines_payslip_uq") ||
      c.includes("payroll_payment_lines_batch_user_uq")
    ) {
      return payrollConflict(
        "PAYMENT_BATCH_CONFLICT",
        PAYROLL_ERR.PAYEE_ALREADY_IN_BATCH,
        payrollDetails("payee-already-in-batch"),
      );
    }
    if (c.includes("payroll_payment_batches_company_code_uq")) {
      return payrollConflict(
        "PAYMENT_BATCH_CONFLICT",
        PAYROLL_ERR.BATCH_CODE_EXISTS,
        payrollDetails("batch-code-exists"),
      );
    }
    if (c.includes("payroll_budgets_year_unit_uq")) {
      return payrollConflict(
        "BUDGET_EXISTS",
        PAYROLL_ERR.BUDGET_EXISTS,
        payrollDetails("budget-exists"),
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
    // S15-PAYROLL-BE-3 (mig 0575, nợ security DB-1B MEDIUM) — thưởng/phạt `Approved` tự duyệt. Service 027 tiền-kiểm
    // `decided_by <> created_by` ⇒ nhánh này là lưới cuối cho RACE / đường ghi nội bộ; CÙNG mã + kind với 027.
    if (c.includes("bonus_penalties_four_eyes_check")) {
      return payrollConflict(
        "BONUS_SELF_APPROVAL",
        PAYROLL_ERR.BONUS_SELF_APPROVAL,
        payrollDetails("self-approval"),
      );
    }
    // ── S15-PAYROLL-BE-4 — CHECK track C (mig 0572) ──
    // Four-eyes tạm ứng: service 063 tiền-kiểm `created_by === actor OR user_id === actor` dưới `FOR UPDATE`; CHECK
    // chỉ soi `created_by` và là lưới cuối cho RACE / đường ghi nội bộ ⇒ CÙNG mã 025 + kind `self-approval`.
    if (c.includes("payroll_advances_four_eyes_check")) {
      return payrollConflict(
        "ADVANCE_CONFLICT",
        PAYROLL_ERR.ADVANCE_SELF_APPROVAL,
        payrollDetails("self-approval"),
      );
    }
    // Ba CHECK Zod đã mirror ĐÚNG BẰNG ⇒ 400 lưới cuối (plan-review B4), KHÔNG 500 vùng đỏ.
    if (
      c.includes("payroll_payment_batches_completed_pair_check") ||
      c.includes("payroll_payment_lines_bank_pair_check") ||
      c.includes("payroll_advances_deducted_bound_check")
    ) {
      return payrollBadRequest(c);
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
    // 🩹 S15-PAYROLL-BE-1 (security review HIGH #2) — BA CHECK của v2 trước đó KHÔNG có nhánh nào ⇒
    // rơi `null` ⇒ service ném thẳng `DrizzleQueryError` ⇒ **500 vùng đỏ**. Với
    // `payroll_employee_settings_bank_pair_check` thì nặng hơn một bậc: message của drizzle là
    // `Failed query: … params: …`, nên **SỐ TÀI KHOẢN ĐẦY ĐỦ đi vào log** khi filter ghi `stack` cho 5xx.
    // Service đã tiền-kiểm trên hàng SAU MERGE; ba nhánh dưới là lưới cuối cho RACE/đường gọi nội bộ.
    if (c.includes("payroll_employee_settings_bank_pair_check")) {
      return payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.BANK_PAIR_INCOMPLETE,
        payrollDetails("bank-pair-incomplete"),
      );
    }
    if (c.includes("payroll_dependents_period_check")) {
      return payrollConflict(
        "DEPENDENT_OVERLAP",
        PAYROLL_ERR.DEPENDENT_OVERLAP,
        payrollDetails("dependent-overlap", { reason: "effective-to-before-from" }),
      );
    }
    // `salary_profile_items_amount_check` (amount >= 0): Zod `.nonnegative()` mirror ĐÚNG BẰNG nên tới
    // được đây là payload lách tầng validate ⇒ 400 hình thức, cùng luật `payroll_period_lines_adjustment_check`.
    if (c.includes("salary_profile_items_amount_check")) return null;
    // ── S15-PAYROLL-BE-2 — CHECK track B. Service tiền-kiểm; các nhánh dưới là lưới cuối (race / đường nội
    //    bộ). Để rơi `null` là 500 vùng đỏ — nên CÓ map kể cả khi SPEC-11 §12.1 cũ ghi «400». ──
    if (c.includes("salary_components_code_shape_check")) {
      return payrollConflict(
        "COMPONENT_CONFLICT",
        PAYROLL_ERR.COMPONENT_CODE_RESERVED(""),
        payrollDetails("component-code-reserved"),
      );
    }
    if (c.includes("salary_components_system_not_deletable")) {
      return payrollConflict(
        "COMPONENT_CONFLICT",
        PAYROLL_ERR.COMPONENT_SYSTEM_IMMUTABLE,
        payrollDetails("system-component-immutable"),
      );
    }
    if (
      c.includes("salary_components_value_pair_check") ||
      c.includes("salary_components_engine_kind_check")
    ) {
      return payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.COMPONENT_VALUE_PAIR,
        payrollDetails("component-value-pair"),
      );
    }
    // `*_formula_len_check` (≤ 500): service parse TRƯỚC khi ghi nên tới được đây là đường lách tiền-kiểm
    // (security-review BE-2 MEDIUM-2 — 047 từng bỏ parse khi hàng ngưng dùng) ⇒ 422 018, KHÔNG 500.
    if (
      c.includes("salary_components_formula_len_check") ||
      c.includes("payroll_template_components_formula_len_check")
    ) {
      return payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.FORMULA_TOO_LONG_STORED,
        payrollDetails("formula-too-long"),
      );
    }
    if (c.includes("payroll_templates_scope_pair_check")) {
      return payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.TEMPLATE_SCOPE_PAIR,
        payrollDetails("template-scope-pair"),
      );
    }
    if (c === "") {
      // Luật 3 — khớp DƯƠNG theo tiền tố message của trigger (xem JSDoc).
      const message = pgNodeMessage(err);
      if (message.startsWith("salary_components:")) {
        return payrollConflict(
          "COMPONENT_CONFLICT",
          PAYROLL_ERR.COMPONENT_SYSTEM_IMMUTABLE,
          payrollDetails("system-component-immutable"),
        );
      }
      if (message.startsWith("bonus_penalty_freeze_guard:")) {
        return payrollConflict(
          "BONUS_ALREADY_CONSUMED",
          PAYROLL_ERR.BONUS_FROZEN_RACE,
          payrollDetails("bonus-frozen-race"),
        );
      }
      // S15-PAYROLL-BE-4 — ba trigger track C (mig 0572) map theo TAG `<trigger>:<tag>:`; tag ngoài bảng ⇒ `null`
      // (500 CÓ CHỦ ĐÍCH — service phải chặn trước, plan §3.6). Bảng sống ở `payroll-pg-error.tags.ts`.
      return mapPayrollTrackCTag(message);
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
      c.includes("payslips_user_id") ||
      // S15-PAYROLL-BE-1 — ba bảng mới neo `user_id`; cùng luật sentinel với ba bảng trên (không tồn
      // tại VÀ khác tenant phải trả CÙNG một phản hồi, kẻo dựng oracle "user này có thật ở đâu đó").
      c.includes("payroll_employee_settings_user_id") ||
      c.includes("payroll_dependents_user_id") ||
      // S15-PAYROLL-BE-2 — đơn vị được CHỌN cho mẫu `scope='org_unit'` (không tồn tại / khác tenant ⇒ cùng 404).
      c.includes("payroll_templates_org_unit_id_company_fk") ||
      // S15-PAYROLL-BE-4 — nhân sự được CHỌN cho tạm ứng/dòng chi · đơn vị được CHỌN cho ngân sách (composite
      // tenant-FK của mig 0572: không tồn tại VÀ khác tenant ⇒ CÙNG 404, không dựng oracle).
      c.includes("payroll_advances_user_id") ||
      c.includes("payroll_payment_lines_user_id") ||
      c.includes("payroll_budgets_org_unit_id")
    ) {
      return payrollNotFound();
    }
    // S15-PAYROLL-BE-2 — `componentId` trong danh sách 053 không thuộc catalog công ty (race sau tiền-kiểm).
    if (c.includes("payroll_template_components_component_id_company_fk")) {
      return payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.TEMPLATE_COMPONENT_UNKNOWN,
        payrollDetails("template-component-unknown"),
      );
    }
    return null;
  }
  // S15-PAYROLL-BE-1 — `EXCLUDE USING gist` ném `23P01`, KHÔNG nằm trong ba mã trên. Service đã
  // tiền-kiểm chồng lấp, nên tới được đây là RACE hai request chen nhau ⇒ 409, tuyệt đối không 500.
  if (code === PG_EXCLUSION_VIOLATION) {
    const c = pgErrorField(err, "constraint") ?? "";
    if (c.includes("payroll_dependents_no_overlap_excl")) {
      return payrollConflict(
        "DEPENDENT_OVERLAP",
        PAYROLL_ERR.DEPENDENT_OVERLAP,
        payrollDetails("dependent-overlap"),
      );
    }
    return null;
  }
  return null;
}

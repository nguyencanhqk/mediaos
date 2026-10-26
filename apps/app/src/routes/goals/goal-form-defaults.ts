/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — mặc định THUẦN của form tạo mục tiêu (`/goals/new`).
 *
 * Nhân viên tạo mục tiêu quý chỉ với tên và chỉ tiêu: cấp, chủ thể, kỳ, trạng thái đã điền sẵn.
 *  - Cấp = Nhân viên, chủ thể = chính mình (`/auth/me.employee.id`) khi được phép tự neo.
 *  - Loại kỳ = Quý, hai ngày = đầu/cuối quý hiện tại theo GIỜ CÔNG TY (`quarterRange`/`yearRange` của
 *    S20-FE-COMPANYTZ-1) — không bộ đổi múi thứ hai, không đọc giờ máy.
 *  - Trạng thái theo cấp (owner chốt Q11 = B): Active cho cấp Nhân viên, Draft cho Phòng/Dự án. SPEC-10
 *    không có luồng phê duyệt mục tiêu (GOAL-DEC-003) nên mặc định Active không phá bất biến nào.
 *
 * Chỉ là GỢI Ý điền sẵn: BE vẫn validate GOAL-ERR-001/003/010 và phạm vi `create:goal` khi lưu (request
 * sửa tay `level=department` của người chỉ có Own vẫn bị từ chối như trước).
 */
import { quarterRange, yearRange, type DataScope, type LocalDateRange } from "@mediaos/web-core";
import type { GoalPeriodTypeDto } from "@mediaos/contracts";
import { EMPTY_GOAL_FORM, type GoalFormValues } from "./goal-form-schema";
import { applyGoalFormPrefill, type GoalFormPrefill } from "./goal-form-prefill";
import { isLocalDate } from "./goal-list-search";

/** Cấp mặc định của form tạo nhanh: mục tiêu cá nhân. */
const QUICK_START_LEVEL = "employee" as const satisfies GoalFormValues["level"];
const QUICK_START_PERIOD: GoalPeriodTypeDto = "quarter";
const OWN_SCOPE: DataScope = "Own";

/**
 * `create:goal` CHỈ có phạm vi Own ⇒ người dùng chỉ tạo được mục tiêu của chính mình: form ẩn hai ô Cấp
 * và Chủ thể. Quy tắc DƯƠNG: mọi phạm vi khác (Team/Department/Company/System) hoặc khoá vắng/rỗng (chưa
 * biết) ⇒ false — form giữ đủ ô để chọn, BE là cổng cuối.
 */
export function isCreateGoalOwnOnly(scopes: readonly DataScope[] | undefined): boolean {
  return Boolean(scopes && scopes.length > 0 && scopes.every((scope) => scope === OWN_SCOPE));
}

/** Q11 = B — Active cho cấp Nhân viên; Draft cho Phòng/Dự án (và khi chưa chọn cấp). */
export function defaultGoalStatusForLevel(
  level: GoalFormValues["level"],
): Extract<GoalFormValues["status"], "Active" | "Draft"> {
  return level === "employee" ? "Active" : "Draft";
}

/**
 * Ngày đầu/cuối của loại kỳ tại `now` theo múi `timeZone`; Tuỳ chỉnh (hoặc giá trị lạ từ ô chọn) ⇒ null
 * (giữ ngày đang có để sửa tay).
 */
export function goalPeriodRangeFor(
  periodType: GoalPeriodTypeDto | string,
  now: Date,
  timeZone: string,
): LocalDateRange | null {
  if (periodType === "quarter") return quarterRange(now, timeZone);
  if (periodType === "year") return yearRange(now, timeZone);
  return null;
}

export interface GoalFormDefaultsInput {
  readonly now: Date;
  /** Múi giờ CÔNG TY (`companyTimeZone()`), không phải múi cá nhân. */
  readonly timeZone: string;
  /** `employee.id` của chính mình từ `/auth/me`; null = chưa gắn hồ sơ hoặc không lấy được. */
  readonly selfEmployeeId: string | null;
  /** Được tự neo chủ thể vào chính mình (false khi phân rã từ mục tiêu cha cho người khác). */
  readonly anchorSelf: boolean;
}

/** Giá trị khởi đầu của form TẠO (form SỬA vẫn điền từ bản ghi). */
export function goalFormDefaults(input: GoalFormDefaultsInput): GoalFormValues {
  const range = goalPeriodRangeFor(QUICK_START_PERIOD, input.now, input.timeZone);
  return {
    ...EMPTY_GOAL_FORM,
    level: QUICK_START_LEVEL,
    employeeId: input.anchorSelf && input.selfEmployeeId ? input.selfEmployeeId : "",
    periodType: QUICK_START_PERIOD,
    periodStart: range?.start ?? "",
    periodEnd: range?.end ?? "",
    status: defaultGoalStatusForLevel(QUICK_START_LEVEL),
  };
}

/**
 * Tự neo chủ thể vào chính mình? Chỉ Own ⇒ luôn (không còn ai khác để chọn). Phạm vi rộng hơn ⇒ chỉ
 * khi KHÔNG mở từ mục tiêu cha: phân rã từ cha là giao cho người khác, điền sẵn «tôi» dễ tạo nhầm.
 */
export function shouldAnchorSelf(ownOnly: boolean, prefill: GoalFormPrefill): boolean {
  return ownOnly || !prefill.parentGoalId;
}

export interface GoalCreateInitialInput {
  readonly now: Date;
  readonly timeZone: string;
  readonly selfEmployeeId: string | null;
  /** `create:goal` chỉ Own (`isCreateGoalOwnOnly`). */
  readonly ownOnly: boolean;
}

/**
 * Giá trị khởi đầu của form TẠO = mặc định + gợi ý từ search (S20-GOAL-LISTURL-1).
 *  - Mở từ cha ⇒ Active (luật của LISTURL: Nháp là thêm một bước); không ⇒ trạng thái theo cấp (Q11 = B).
 *  - Chỉ Own ⇒ cấp luôn là Nhân viên (hai ô bị ẩn; `?level=` gõ tay không đổi được cấp ở FE, BE vẫn
 *    từ chối như cũ nếu request bị sửa).
 */
export function goalCreateInitialValues(
  input: GoalCreateInitialInput,
  prefill: GoalFormPrefill,
): GoalFormValues {
  const base = goalFormDefaults({
    now: input.now,
    timeZone: input.timeZone,
    selfEmployeeId: input.selfEmployeeId,
    anchorSelf: shouldAnchorSelf(input.ownOnly, prefill),
  });
  const merged = applyGoalFormPrefill(base, prefill);
  const level = input.ownOnly ? QUICK_START_LEVEL : merged.level;
  return {
    ...merged,
    level,
    status: prefill.parentGoalId ? merged.status : defaultGoalStatusForLevel(level),
  };
}

// ── S20-GOAL-PARENTPICKER-1 (US-GOAL-NV-12) — kỳ theo mục tiêu cha ─────────────────────────────────

/** Ba trường kỳ của form (cùng ba trường mà `goalFormDefaults` điền sẵn). */
export type GoalPeriodValues = Pick<GoalFormValues, "periodType" | "periodStart" | "periodEnd">;

/** Kỳ của mục tiêu con lấy theo cha: chọn cha khi kỳ còn mặc định ⇒ form điền đúng ba trường này. */
export function parentPeriodValues(parent: {
  readonly periodType: GoalPeriodTypeDto;
  readonly periodStart: string;
  readonly periodEnd: string;
}): GoalPeriodValues {
  return {
    periodType: parent.periodType,
    periodStart: parent.periodStart,
    periodEnd: parent.periodEnd,
  };
}

/**
 * Kỳ con nằm NGOÀI kỳ cha (bắt đầu trước, hoặc kết thúc sau)? Chỉ để hiện CẢNH BÁO MỀM — không chặn
 * lưu (SPEC-10 không có luật kỳ con ⊆ kỳ cha). Thiếu căn cứ (ngày trống/sai định dạng ở con hoặc cha)
 * ⇒ false: lỗi kỳ của con đã có thông điệp riêng, không cảnh báo chồng. Ngày dạng `YYYY-MM-DD` hợp lệ
 * so sánh được bằng chuỗi.
 */
export function isPeriodOutsideParent(
  child: { readonly periodStart: string; readonly periodEnd: string },
  parent: { readonly periodStart: string; readonly periodEnd: string },
): boolean {
  const dates = [child.periodStart, child.periodEnd, parent.periodStart, parent.periodEnd];
  if (!dates.every(isLocalDate)) return false;
  return child.periodStart < parent.periodStart || child.periodEnd > parent.periodEnd;
}

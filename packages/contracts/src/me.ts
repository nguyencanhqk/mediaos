import { z } from "zod";

/**
 * S5-ME-BE-1 — FOUNDATION DTO cho module ME (Trung tâm cá nhân / Personal Hub).
 *
 * NGUỒN SỰ THẬT DTO (CLAUDE.md §4): shape response ME sống Ở ĐÂY — apps/api (MeAggregationService /
 * MeController) import LẠI, KHÔNG khai báo shape cục bộ (tránh drift với FE).
 *
 * Căn cứ: SPEC-09 §13 (trạng thái UI bắt buộc — union CÓ 'forbidden') · §14.2/§14.4 (endpoint tổng hợp +
 * nguyên tắc: resolve từ token, KHÔNG nhận user_id/employee_id, summary có trạng thái RIÊNG từng section) ·
 * §12.2 (unlinked_employee) · §12.3 (module_disabled — không stale) · §12.4 (ME-ERR-DATA-INCONSISTENT) ·
 * §10.1 (nội dung overview) · API-11 §8.3/§8.4.
 *
 * BẤT BIẾN masking (CLAUDE.md §2/§5): DTO ME KHÔNG chứa field nhạy cảm (salary/PII chi tiết/password_hash/
 * refresh_token/token/secret/storage-path). ME chỉ TỔNG HỢP dữ liệu ĐÃ MASK ở module nguồn — masking là việc
 * của service nguồn, KHÔNG lộ thêm qua ME. Identity chỉ giữ dữ liệu org tối thiểu (mã NV/tên/phòng ban/chức vụ)
 * + email đăng nhập (SPEC-09 §10.4) — KHÔNG kèm phone/địa chỉ/DOB/permission nội bộ chi tiết (§17.1).
 */

// ─── Mã lỗi ME (SPEC-09 §12.4 · API-11 §8.4) ──────────────────────────────────
//
// APPEND-ONLY (theo pattern packages/contracts/src/foundation/error-codes.ts): thêm mã mới ở CUỐI, KHÔNG
// đổi/xoá chuỗi mã đã có (client bắt theo error.code). Guard-level 403 GIỮ AUTH-ERR-FORBIDDEN — KHÔNG dùng
// mã ở đây. Chỉ ForbiddenException do business-rule mới mang mã ME-ERR-*.

export const ME_ERROR_CODES = {
  /**
   * 409 — user liên kết >1 employee ACTIVE bất thường (SPEC-09 §12.4): KHÔNG tự chọn ngẫu nhiên, trả lỗi
   * cấu hình dữ liệu + ghi audit/alert (object_type='user'), cần Admin/HR xử lý.
   */
  DATA_INCONSISTENT: "ME-ERR-DATA-INCONSISTENT",
  /**
   * Tài khoản chưa liên kết hồ sơ nhân viên (SPEC-09 §12.2). Ở endpoint tổng hợp: section HR/ATT/LEAVE mang
   * status 'unlinked_employee' (KHÔNG ném); mã này dành cho endpoint yêu cầu employee bắt buộc (API-11 §8.4).
   */
  UNLINKED_EMPLOYEE: "ME-ERR-UNLINKED-EMPLOYEE",
} as const;

export type MeErrorCode = (typeof ME_ERROR_CODES)[keyof typeof ME_ERROR_CODES];

// ─── Section-status envelope (SPEC-09 §13 · API-11 §8.3) ──────────────────────
//
// Mỗi section tổng hợp mang trạng thái RIÊNG → 1 nguồn lỗi/thiếu-quyền KHÔNG làm 500 toàn response.
// Union PHẢI CÓ 'forbidden' (thiếu quyền NGUỒN) — phân biệt rõ với 'error' (infra) và 'module_disabled'
// (company tắt module) và 'unlinked_employee' (chưa liên kết NV). 404-không-dữ-liệu KHÔNG map thành
// 'forbidden' — dùng 'ok' + data rỗng.

export const meSectionStatusEnum = z.enum([
  /** Đọc thành công (kể cả rỗng — không có dữ liệu vẫn là 'ok', KHÔNG 'forbidden'). */
  "ok",
  /** Lỗi hạ tầng / non-HttpException từ reader nguồn (degraded — §18.2). */
  "error",
  /** Thiếu cặp quyền NGUỒN (ForbiddenException 403) — KHÔNG đọc dữ liệu (SPEC-09 §13). */
  "forbidden",
  /** Company tắt module nguồn (§12.3) — KHÔNG trả dữ liệu stale. */
  "module_disabled",
  /** Tài khoản chưa liên kết hồ sơ nhân viên (§12.2) — section phụ thuộc employee. */
  "unlinked_employee",
]);
export type MeSectionStatus = z.infer<typeof meSectionStatusEnum>;

/**
 * Factory bao 1 section: `{ status, data }`. `data` null ở mọi status ≠ 'ok'. Dùng cho từng summary section
 * (attendance/leave/task/notification) và endpoint chuyên biệt tương ứng.
 */
export function meSectionSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    status: meSectionStatusEnum,
    data: dataSchema.nullable(),
  });
}

/** Envelope section OPAQUE (khi consumer không quan tâm shape trong) — data = unknown|null. */
export const meSectionEnvelopeSchema = meSectionSchema(z.unknown());
export type MeSectionEnvelope = z.infer<typeof meSectionEnvelopeSchema>;

// ─── MeIdentity — account từ token + link employee tối thiểu (SPEC-09 §12.1 · §10.4) ─────────────

/** Trạng thái liên kết employee của tài khoản hiện tại (§12.2). */
export const meLinkStatusEnum = z.enum(["linked", "unlinked"]);
export type MeLinkStatus = z.infer<typeof meLinkStatusEnum>;

/**
 * Tài khoản đăng nhập (AUTH — SPEC-09 §10.4). CHỈ dữ liệu account hiển thị: email đăng nhập, trạng thái, role
 * (TÊN hiển thị, KHÔNG lộ cấu trúc permission chi tiết — §17.1). KHÔNG có password_hash/token/secret.
 */
export const meAccountSchema = z.object({
  userId: z.string().uuid(),
  /** Email đăng nhập (SPEC-09 §10.4 — không phải secret). */
  email: z.string(),
  /** Trạng thái tài khoản (Active/…) — string để không trôi khỏi CHECK khi AUTH thêm trạng thái. */
  status: z.string(),
  displayName: z.string().nullable(),
  /** Danh sách role (chỉ id + tên hiển thị — §10.4). KHÔNG kèm danh mục permission chi tiết. */
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type MeAccount = z.infer<typeof meAccountSchema>;

/**
 * Link employee TỐI THIỂU (HR — SPEC-09 §10.4). CHỈ dữ liệu org không nhạy cảm (mã NV/tên/phòng ban/chức vụ).
 * KHÔNG kèm PII (DOB/phone/địa chỉ/lương) — các field đó thuộc GET /me/profile với masking HR riêng.
 */
export const meEmployeeLinkSchema = z.object({
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  departmentName: z.string().nullable(),
  positionName: z.string().nullable(),
});
export type MeEmployeeLink = z.infer<typeof meEmployeeLinkSchema>;

/**
 * GET /api/v1/me — danh tính user hiện tại. `account` LUÔN có (kể cả chưa liên kết employee — §12.2);
 * `employee` null khi `linkStatus='unlinked'`. Resolve 100% từ access token (§14.4), KHÔNG nhận owner ID.
 */
export const meIdentitySchema = z.object({
  account: meAccountSchema,
  linkStatus: meLinkStatusEnum,
  employee: meEmployeeLinkSchema.nullable(),
});
export type MeIdentity = z.infer<typeof meIdentitySchema>;

// ─── Summary DTO từng section (data của section-envelope) ─────────────────────

/**
 * GET /me/attendance-summary (ATT — SPEC-09 §7.3/§10.1): trạng thái chấm công HÔM NAY (own-scope). `status`
 * để string (nhãn ATT: NotCheckedIn/CheckedIn/CheckedOut/OnLeave/… — không trôi khỏi enum ATT). isLate/
 * isEarlyLeave nullable (chỉ hiển thị nếu company cho phép — §7.3).
 */
export const meAttendanceSummarySchema = z.object({
  /** Ngày công local YYYY-MM-DD. */
  workDate: z.string(),
  status: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  shiftName: z.string().nullable(),
  isLate: z.boolean().nullable(),
  isEarlyLeave: z.boolean().nullable(),
});
export type MeAttendanceSummary = z.infer<typeof meAttendanceSummarySchema>;

/** 1 dòng số dư phép (rút gọn từ LeaveBalanceView — KHÔNG tự tính lại, §7.4). */
export const meLeaveBalanceLineSchema = z.object({
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  remainingDays: z.number(),
  unit: z.string(),
});
export type MeLeaveBalanceLine = z.infer<typeof meLeaveBalanceLineSchema>;

/**
 * GET /me/leave-summary (LEAVE — SPEC-09 §7.4/§10.1): số dư phép còn lại + số đơn đang chờ duyệt (own).
 * ME KHÔNG tự tính lại số dư — chỉ tổng hợp từ LeaveReadService.
 */
export const meLeaveSummarySchema = z.object({
  balances: z.array(meLeaveBalanceLineSchema),
  pendingRequestCount: z.number().int().nonnegative(),
});
export type MeLeaveSummary = z.infer<typeof meLeaveSummarySchema>;

/**
 * GET /me/task-summary (TASK — SPEC-09 §7.5/§10.1): đếm task own-scope (được giao / đến hạn hôm nay / quá
 * hạn). ME KHÔNG thay trang My Tasks — chỉ roll-up đếm, 1 reader (KHÔNG N+1 theo widget — §18.1).
 */
export const meTaskSummarySchema = z.object({
  assignedCount: z.number().int().nonnegative(),
  dueTodayCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
});
export type MeTaskSummary = z.infer<typeof meTaskSummarySchema>;

/**
 * GET /me/notification-summary (NOTI — SPEC-09 §7.6/§10.1): đếm chưa đọc (own). Mirror shape
 * MyNotificationUnreadCountResponse (unread + high/urgent + last).
 */
export const meNotificationSummarySchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  highPriorityUnreadCount: z.number().int().nonnegative(),
  urgentUnreadCount: z.number().int().nonnegative(),
  lastNotificationAt: z.string().nullable(),
});
export type MeNotificationSummary = z.infer<typeof meNotificationSummarySchema>;

// ─── Section-envelope đã ghép data (response endpoint chuyên biệt + phần tử overview) ──────────

/** GET /me/attendance-summary — `data` = envelope section (status + summary|null). */
export const meAttendanceSectionSchema = meSectionSchema(meAttendanceSummarySchema);
export type MeAttendanceSection = z.infer<typeof meAttendanceSectionSchema>;

/** GET /me/leave-summary. */
export const meLeaveSectionSchema = meSectionSchema(meLeaveSummarySchema);
export type MeLeaveSection = z.infer<typeof meLeaveSectionSchema>;

/** GET /me/task-summary. */
export const meTaskSectionSchema = meSectionSchema(meTaskSummarySchema);
export type MeTaskSection = z.infer<typeof meTaskSectionSchema>;

/** GET /me/notification-summary. */
export const meNotificationSectionSchema = meSectionSchema(meNotificationSummarySchema);
export type MeNotificationSection = z.infer<typeof meNotificationSectionSchema>;

// ─── MeOverview — gom danh tính + mọi section (SPEC-09 §10.1 · §14.2) ──────────

/**
 * GET /api/v1/me/overview — tổng quan cá nhân. `identity` LUÔN có (account ok kể cả unlinked); mỗi section
 * mang status RIÊNG (fail-soft §18.2): 1 nguồn forbidden/error/module_disabled/unlinked KHÔNG làm hỏng
 * section khác, HTTP vẫn 200.
 */
export const meOverviewSchema = z.object({
  identity: meIdentitySchema,
  attendance: meAttendanceSectionSchema,
  leave: meLeaveSectionSchema,
  task: meTaskSectionSchema,
  notification: meNotificationSectionSchema,
});
export type MeOverview = z.infer<typeof meOverviewSchema>;

/**
 * Hằng quyền + helper cho module Đơn điều chỉnh công (S3-FE-ATT-3, S3-ATT-BE-4 — ATT-FUNC-018..022).
 *
 * QUAN TRỌNG (SENSITIVE_CAPABILITY_ALLOWLIST trap): view-own/view-team/view-company/approve/reject:adjustment
 * VÀ adjust-direct:attendance đều `is_sensitive=true` trong catalog (attendance-permissions.const.ts mig 0454)
 * NHƯNG KHÔNG nằm trong SENSITIVE_CAPABILITY_ALLOWLIST (apps/api/src/permission/permission.service.ts) — chỉ
 * view-own/team/company:attendance + view:leave được "mở cờ" hiển thị. Hệ quả: useCan()/useCanExact() trên các
 * cặp adjustment/adjust-direct này LUÔN false — kể cả người dùng CÓ quyền thật (giống trap đã ghi ở
 * AttendanceRecordDetailPage.tsx cho view-detail:attendance). QUY TẮC: KHÔNG front-gate render bằng useCan
 * trên các cặp này; server 403/404 là cổng thật — page render shell/list vô điều kiện rồi xử lý theo response
 * (ApiError.status). Route/sidebar dùng cặp ALLOWLISTED liên quan (view-own/team/company:attendance) làm
 * "reach permission" (ai xem được bảng công tương ứng thì có thể vào màn — cổng chính xác vẫn ở server).
 */
import { ATT_ENGINE_PAIRS } from "../constants";

export const ADJUSTMENT_ENGINE_PAIRS = {
  /** create-own:adjustment — non-sensitive → useCan() dùng an toàn làm gate thật. */
  CREATE_OWN: ATT_ENGINE_PAIRS.CREATE_OWN_ADJUSTMENT,
  /** Các cặp dưới đây SENSITIVE + KHÔNG allowlisted — xem ghi chú đầu file, KHÔNG front-gate. */
  VIEW_OWN: ATT_ENGINE_PAIRS.VIEW_OWN_ADJUSTMENT,
  VIEW_TEAM: { action: "view-team", resourceType: "adjustment" },
  VIEW_COMPANY: { action: "view-company", resourceType: "adjustment" },
  APPROVE: { action: "approve", resourceType: "adjustment" },
  REJECT: { action: "reject", resourceType: "adjustment" },
  ADJUST_DIRECT: ATT_ENGINE_PAIRS.ADJUST_DIRECT,
} as const;

/** Reach-permission cho route/sidebar (cặp ALLOWLISTED, dùng làm gợi ý hiển thị — KHÔNG phải cổng thật). */
export const ADJUSTMENT_REACH_PERMISSIONS = {
  MY: ["ATT.ATTENDANCE.VIEW_OWN"],
  MANAGE: ["ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
  DETAIL: ["ATT.ATTENDANCE.VIEW_OWN", "ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
} as const;

/** Nhãn loại yêu cầu (ATT-FUNC-018 bảng "Loại yêu cầu điều chỉnh") — key khớp ATTENDANCE_ADJUSTMENT_REQUEST_TYPES. */
export const ADJUSTMENT_REQUEST_TYPE_LABEL_KEYS = [
  "MISSING_CHECK_IN",
  "MISSING_CHECK_OUT",
  "UPDATE_CHECK_IN",
  "UPDATE_CHECK_OUT",
  "EXPLAIN_LATE",
  "EXPLAIN_EARLY_LEAVE",
  "UPDATE_STATUS",
  "REMOTE_CORRECTION",
  "OTHER",
] as const;

export const CHECK_IN_REQUEST_TYPES = new Set<string>(["MISSING_CHECK_IN", "UPDATE_CHECK_IN"]);
export const CHECK_OUT_REQUEST_TYPES = new Set<string>(["MISSING_CHECK_OUT", "UPDATE_CHECK_OUT"]);

/** Trạng thái đơn điều chỉnh (FSM DB-04 §7.6) — Draft → Pending → Approved | Rejected | Cancelled. */
export const ADJUSTMENT_STATUS = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;

/** Page size mặc định cho danh sách đơn điều chỉnh. */
export const ADJUSTMENT_PAGE_SIZE = 20;

/**
 * <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm", giờ LOCAL trình duyệt) → ISO UTC cho contract
 * `.datetime()`. Rỗng/không hợp lệ → undefined (field optional, KHÔNG gửi lên server).
 */
export function localDatetimeToIso(local: string | undefined): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** ISO UTC → <input type="datetime-local"> value (giờ LOCAL trình duyệt) cho hiển thị/prefill. */
export function isoToLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

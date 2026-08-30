import { z } from "zod";

/**
 * S11-ROOM-DB-1 — enum/hằng chuẩn module ROOM (SPEC-14 · DB-16 §7). NGUỒN SỰ THẬT cho DTO của S11-ROOM-BE-1 (API-15).
 *
 * `roomBookingStatusSchema` MIRROR ĐÚNG BẰNG CHECK `chk_room_bookings_status` của migration 0552 — HAI CHIỀU: không
 * chặt hơn (giá trị DB hợp lệ mà Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 check-violation
 * vô danh — `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `room.spec.ts` (mảng literal chép từ
 * migration, cố ý KHÔNG import từ schema drizzle). Các schema còn lại CHỈ có ở Zod (DB không CHECK) — DB-16 §7.
 *
 * Chỉ ENUM/HẰNG ở WO DB (chưa có consumer DTO); request/response schema viết ở WO BE cùng API-15.
 */

/** `chk_room_bookings_status` — SPEC-01 §17.10. `Completed` là DẪN XUẤT (status Confirmed ∧ ends_at ≤ now) — không cột. */
export const roomBookingStatusSchema = z.enum(["Confirmed", "Cancelled"]);
export type RoomBookingStatusDto = z.infer<typeof roomBookingStatusSchema>;

/** Bộ lọc `status` của API danh sách lượt (chỉ Zod — DB-16 §7). */
export const roomBookingStatusFilterSchema = z.enum(["Confirmed", "Cancelled", "all"]);
export type RoomBookingStatusFilterDto = z.infer<typeof roomBookingStatusFilterSchema>;

/** Bộ lọc `role` của `/me/room-bookings` (chỉ Zod — DB-16 §7). */
export const myRoomBookingRoleFilterSchema = z.enum(["organizer", "attendee", "all"]);
export type MyRoomBookingRoleFilterDto = z.infer<typeof myRoomBookingRoleFilterSchema>;

/** `meeting_rooms.equipment` — mảng chuỗi tự do, ≤ 20 mục / 1–40 ký tự mỗi mục (DB-16 §6.1/§7; DB không CHECK). */
export const ROOM_EQUIPMENT_MAX_ITEMS = 20;
export const ROOM_EQUIPMENT_ITEM_MAX_LEN = 40;
export const roomEquipmentSchema = z
  .array(z.string().trim().min(1).max(ROOM_EQUIPMENT_ITEM_MAX_LEN))
  .max(ROOM_EQUIPMENT_MAX_ITEMS);
export type RoomEquipmentDto = z.infer<typeof roomEquipmentSchema>;
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// S11-ROOM-BE-1 — DTO request/response (API-15 · SPEC-14 §12/§13). Thêm vào CÙNG file (không file mới).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** SPEC-14 §12 ROOM-ERR-002 — luật khung giờ ĐẶT (kiểm ở service, thứ tự cố định). */
export const ROOM_BOOKING_MIN_MINUTES = 15;
export const ROOM_BOOKING_MAX_HOURS = 8;
export const ROOM_BOOKING_PAST_TOLERANCE_MINUTES = 5;
export const ROOM_BOOKING_MAX_AHEAD_DAYS = 90;
/** Cửa sổ TRA CỨU lịch `[from, to)` ≤ 31 ngày (API-15 §6.12); usage-summary ≤ 366 ngày. */
export const ROOM_WINDOW_MAX_DAYS = 31;
/** Trần HÀNG cho lịch phẳng trong cửa sổ (database gate H1 — không unbounded read); vượt ⇒ FE thu hẹp cửa sổ. */
export const ROOM_WINDOW_MAX_ROWS = 2000;
export const ROOM_USAGE_WINDOW_MAX_DAYS = 366;
/** SPEC-14 §12 ROOM-ERR-006 `too-many-attendees`. */
export const ROOM_MAX_ATTENDEES = 50;
export const ROOM_PAGE_MAX = 100;
export const ROOM_PAGE_DEFAULT = 20;
export const ROOM_CAPACITY_MAX = 1000;
export const ROOM_NAME_MAX = 120;
export const ROOM_LOCATION_MAX = 120;
export const ROOM_DESCRIPTION_MAX = 2000;
export const ROOM_SORT_ORDER_MAX = 10_000;
export const ROOM_BOOKING_TITLE_MAX = 255;
export const ROOM_CANCEL_REASON_MAX = 500;
export const ROOM_LIST_ROOM_IDS_MAX = 50;
export const ROOM_SEARCH_MAX = 100;

/** Boolean từ query-string — preprocess IDEMPOTENT (pipe chạy 2 lần: global + method). */
const queryBoolSchema = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean().optional());

/** Mảng từ query-string: `?k=a&k=b` (mảng) · `?k=a` (chuỗi) · CSV `?k=a,b` — idempotent với mảng. */
const queryListSchema = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return v;
  }, z.array(item).max(max).optional());

/** ISO 8601 CÓ offset (`2026-09-02T02:00:00+07:00` hoặc `…Z`) — service `new Date()`; thiếu offset ⇒ 400. */
export const roomIsoDateTimeSchema = z.string().datetime({ offset: true });

const nullableText = (max: number) => z.string().trim().max(max).nullish();
const pageQuerySchema = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(ROOM_PAGE_MAX).default(ROOM_PAGE_DEFAULT),
};
/** `[from, to)` — độ dài/thứ tự kiểm ở SERVICE (422 ROOM-ERR-002 `range-too-wide`), Zod chỉ kiểm định dạng. */
const windowQueryShape = {
  from: roomIsoDateTimeSchema,
  to: roomIsoDateTimeSchema,
};

// ── Phòng (ROOM-API-001..007) ─────────────────────────────────────────────────────────────────────

export const roomSortSchema = z.enum(["sortOrder", "name"]);

export const listRoomsQuerySchema = z.object({
  ...pageQuerySchema,
  /** Màn 004 quản trị: gồm cả phòng `isActive=false` (KHÔNG gồm đã xoá mềm). */
  includeInactive: queryBoolSchema,
  capacityMin: z.coerce.number().int().min(1).max(ROOM_CAPACITY_MAX).optional(),
  /** Tìm theo tên/vị trí (ILIKE). */
  q: z.string().trim().max(ROOM_SEARCH_MAX).optional(),
  sort: roomSortSchema.default("sortOrder"),
});
export type ListRoomsQueryDto = z.infer<typeof listRoomsQuerySchema>;

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(ROOM_NAME_MAX),
  location: nullableText(ROOM_LOCATION_MAX),
  capacity: z.number().int().min(1).max(ROOM_CAPACITY_MAX),
  equipment: roomEquipmentSchema.optional(),
  description: nullableText(ROOM_DESCRIPTION_MAX),
  /** v1: `true` ⇒ phòng TỪ CHỐI đặt (ROOM-ERR-004 `approval-not-supported`, ROOM-DEC-002). */
  requiresApproval: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(ROOM_SORT_ORDER_MAX).optional(),
});
export type CreateRoomDto = z.infer<typeof createRoomSchema>;

/** PATCH phòng — `.strict()`: khoá lạ (`id`, `companyId`, `deletedAt`…) ⇒ 400, không strip im lặng. */
export const updateRoomSchema = createRoomSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  // PATCH rỗng ⇒ 400 (silent-failure gate L2): không UPDATE vô nghĩa + không ghi audit "update" giả.
  .refine((o) => Object.keys(o).length > 0, { message: "Cần ít nhất một trường để sửa" });
export type UpdateRoomDto = z.infer<typeof updateRoomSchema>;

export const roomAvailabilityQuerySchema = z.object({
  ...windowQueryShape,
  capacityMin: z.coerce.number().int().min(1).max(ROOM_CAPACITY_MAX).optional(),
  equipment: queryListSchema(
    z.string().trim().min(1).max(ROOM_EQUIPMENT_ITEM_MAX_LEN),
    ROOM_EQUIPMENT_MAX_ITEMS,
  ),
});
export type RoomAvailabilityQueryDto = z.infer<typeof roomAvailabilityQuerySchema>;

export const roomUsageSummaryQuerySchema = z.object({ ...windowQueryShape });
export type RoomUsageSummaryQueryDto = z.infer<typeof roomUsageSummaryQuerySchema>;

/** `GET /rooms/{id}/bookings` — lịch + lịch sử một phòng trong cửa sổ. */
export const roomBookingsWindowQuerySchema = z.object({
  ...windowQueryShape,
  status: roomBookingStatusFilterSchema.default("Confirmed"),
});
export type RoomBookingsWindowQueryDto = z.infer<typeof roomBookingsWindowQuerySchema>;

export const roomResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  location: z.string().nullable(),
  capacity: z.number().int(),
  equipment: z.array(z.string()),
  description: z.string().nullable(),
  requiresApproval: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Chỉ ở chi tiết 005: lượt `Confirmed` có `endsAt > now`. */
  upcomingCount: z.number().int().optional(),
});
export type RoomResponseDto = z.infer<typeof roomResponseSchema>;

export const roomAvailabilityItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  location: z.string().nullable(),
  capacity: z.number().int(),
  equipment: z.array(z.string()),
});
export type RoomAvailabilityItemDto = z.infer<typeof roomAvailabilityItemSchema>;

export const roomUsageSummaryItemSchema = z.object({
  roomId: z.string().uuid(),
  name: z.string(),
  bookingsCount: z.number().int(),
  hoursBooked: z.number(),
  cancelledCount: z.number().int(),
});
export type RoomUsageSummaryItemDto = z.infer<typeof roomUsageSummaryItemSchema>;

// ── Lượt đặt (ROOM-API-009..013) ──────────────────────────────────────────────────────────────────

export const listRoomBookingsQuerySchema = z.object({
  ...windowQueryShape,
  roomId: queryListSchema(z.string().uuid(), ROOM_LIST_ROOM_IDS_MAX),
  organizerUserId: z.string().uuid().optional(),
  status: roomBookingStatusFilterSchema.default("Confirmed"),
});
export type ListRoomBookingsQueryDto = z.infer<typeof listRoomBookingsQuerySchema>;

export const createRoomBookingSchema = z.object({
  roomId: z.string().uuid(),
  title: z.string().trim().min(1).max(ROOM_BOOKING_TITLE_MAX),
  startsAt: roomIsoDateTimeSchema,
  endsAt: roomIsoDateTimeSchema,
  description: nullableText(ROOM_DESCRIPTION_MAX),
  /** KHÔNG dedupe ở Zod — trùng/chứa organizer là 422 ROOM-ERR-006 `attendee-duplicate` ở service. */
  attendeeUserIds: z.array(z.string().uuid()).max(ROOM_MAX_ATTENDEES).optional(),
  /** Chỉ được honour khi scope `book` = Company (đặt hộ); scope Own gửi khác caller ⇒ 403 ROOM-ERR-010. */
  organizerUserId: z.string().uuid().optional(),
});
export type CreateRoomBookingDto = z.infer<typeof createRoomBookingSchema>;

export const cancelRoomBookingSchema = z.object({
  reason: nullableText(ROOM_CANCEL_REASON_MAX),
});
export type CancelRoomBookingDto = z.infer<typeof cancelRoomBookingSchema>;

export const ROOM_LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /me/room-bookings` — đúng MỘT trong hai cách chọn cửa sổ: `date` (ngày lịch theo `companies.timezone`)
 * HOẶC `from`+`to` (≤ 31 ngày). KHÔNG có tham số người dùng (user từ token — chống IDOR).
 */
export const myRoomBookingsQuerySchema = z
  .object({
    date: z.string().regex(ROOM_LOCAL_DATE_RE, "date phải là YYYY-MM-DD").optional(),
    from: roomIsoDateTimeSchema.optional(),
    to: roomIsoDateTimeSchema.optional(),
    role: myRoomBookingRoleFilterSchema.default("all"),
    includeCancelled: queryBoolSchema,
  })
  .superRefine((q, ctx) => {
    const hasDate = q.date !== undefined;
    const hasRange = q.from !== undefined && q.to !== undefined;
    const partialRange = (q.from !== undefined) !== (q.to !== undefined);
    if (partialRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "from và to phải đi cùng nhau",
      });
      return;
    }
    if (hasDate === hasRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "Chọn đúng một: date HOẶC from+to",
      });
    }
  });
export type MyRoomBookingsQueryDto = z.infer<typeof myRoomBookingsQuerySchema>;

/** Người trong lượt — KHÔNG email/số điện thoại (SPEC-14 §18). `displayName` null khi ngoài scope danh tính. */
export const roomPersonSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  employeeCode: z.string().nullable().optional(),
});
export type RoomPersonDto = z.infer<typeof roomPersonSchema>;

export const roomBookingResponseSchema = z.object({
  id: z.string().uuid(),
  room: z.object({
    id: z.string().uuid(),
    name: z.string(),
    location: z.string().nullable(),
    capacity: z.number().int(),
  }),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  organizer: roomPersonSchema,
  bookedBy: roomPersonSchema.nullable(),
  attendees: z.array(roomPersonSchema),
  status: roomBookingStatusSchema,
  /** DẪN XUẤT ở server: `Confirmed ∧ endsAt ≤ now` (SPEC-01 §17.10) — FE không suy từ đồng hồ máy. */
  isCompleted: z.boolean(),
  /** Server tính theo quyền `cancel` + scope + thời gian. */
  canCancel: z.boolean(),
  cancelledAt: z.string().nullable(),
  cancelledBy: roomPersonSchema.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
});
export type RoomBookingResponseDto = z.infer<typeof roomBookingResponseSchema>;

export const myRoomBookingResponseSchema = roomBookingResponseSchema.extend({
  myRole: z.enum(["organizer", "attendee"]),
});
export type MyRoomBookingResponseDto = z.infer<typeof myRoomBookingResponseSchema>;

/** `details.conflicts[]` của ROOM-ERR-001 (chỉ lượt `Confirmed` giao `[startsAt, endsAt)`). */
export const roomBookingConflictSchema = z.object({
  bookingId: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  organizerName: z.string().nullable(),
});
export type RoomBookingConflictDto = z.infer<typeof roomBookingConflictSchema>;
/** Trần số `conflicts[]` gửi trong `details` của ROOM-ERR-001 (plan-review H2 — `message` không phình). */
export const ROOM_CONFLICTS_MAX = 20;

/** `details` của ROOM-ERR-001 sau khi FE bóc: `kind='overlap'`, `conflicts` (≤ 20), `nextFreeFrom` (ISO hoặc null). */
export const roomConflictsDetailSchema = z.object({
  kind: z.literal("overlap"),
  conflicts: z.array(roomBookingConflictSchema).max(ROOM_CONFLICTS_MAX),
  nextFreeFrom: z.string().nullable(),
  /** `true` khi server trả details ROOM-ERR-001 nhưng HỎNG HÌNH (JSON/schema) — bug, không phải "không trùng". */
  malformed: z.boolean().optional(),
});
export type RoomConflictsDetailDto = z.infer<typeof roomConflictsDetailSchema>;

/**
 * Bóc `error.details` (mảng `ErrorDetail {field,message,rule}` — hình DUY NHẤT `AllExceptionsFilter` cho đi ra)
 * của phản hồi 409 ROOM-ERR-001 thành object có kiểu. Trả `null` nếu không phải details của ROOM-ERR-001.
 * FE dùng hàm này thay vì tự `JSON.parse` (API-15 §7.4).
 */
export function parseRoomConflictsDetail(
  details: ReadonlyArray<{ field: string; message: string; rule?: string }> | null | undefined,
): RoomConflictsDetailDto | null {
  if (!details) return null;
  const get = (field: string) => details.find((d) => d.field === field)?.message;
  if (get("kind") !== "overlap") return null;
  // `null` CHỈ cho "không phải overlap"; hỏng hình (JSON/schema) ⇒ `malformed: true` để FE/log phân biệt bug
  // với trạng thái bình thường (silent-failure gate M3).
  const MALFORMED: RoomConflictsDetailDto = {
    kind: "overlap",
    conflicts: [],
    nextFreeFrom: null,
    malformed: true,
  };
  let conflicts: unknown;
  try {
    conflicts = JSON.parse(get("conflicts") ?? "[]");
  } catch {
    return MALFORMED;
  }
  const next = get("nextFreeFrom");
  const parsed = roomConflictsDetailSchema.safeParse({
    kind: "overlap",
    conflicts,
    nextFreeFrom: next === undefined || next === "null" ? null : next,
  });
  return parsed.success ? parsed.data : MALFORMED;
}

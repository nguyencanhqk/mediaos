/**
 * S11-ROOM-FE-1 — hằng dùng chung của 5 màn ROOM (SPEC-14 §9/§14, SPEC-01 §17.10).
 *
 * Nhãn trạng thái KHÔNG gõ thẳng trong JSX: SPEC-01 §17 buộc dùng constants chung để một lần đổi từ
 * ngữ là đổi khắp nơi. Ở đây giữ **khoá i18n**, không giữ chuỗi tiếng Việt — chuỗi sống ở
 * `i18n/locales/vi/rooms.ts`.
 */
import { ROOM_WINDOW_MAX_DAYS, type RoomBookingStatusDto } from "@mediaos/contracts";

/**
 * Cặp engine THẬT đọc từ CONTROLLER (`rooms`/`room-bookings`/`me-room-bookings`.controller.ts, seed
 * mig 0554) — KHÔNG dùng mã FE `ROOM.RESOURCE.ACTION` qua `PERMISSION_CODE_TO_PAIR`, cùng kỹ thuật
 * `ASSET_ENGINE_PAIRS`/`GOAL_ENGINE_PAIRS` để tránh pair-drift.
 *
 * Cả 5 cặp `is_sensitive = false` (SPEC-14 §11 chốt cùng seed) ⇒ có mặt trong `/auth/me` capabilities
 * ⇒ dùng `useCan` (chỉ cặp NHẠY CẢM mới bị lọc khỏi capabilities và cần `useCanExact`).
 */
export const ROOM_ENGINE_PAIRS = {
  /** Cổng nav menu Phòng họp — KHÔNG route nào enforce, chỉ gate hiển thị. */
  ACCESS: { action: "access", resourceType: "room" },
  /** Đọc phòng · lịch mọi phòng · phòng trống · chi tiết lượt · thống kê · /me/room-bookings. */
  VIEW: { action: "view", resourceType: "room" },
  /** Tạo lượt đặt. @Own ⇒ organizer phải là chính mình; @Company ⇒ được đặt hộ. */
  BOOK: { action: "book", resourceType: "room" },
  /** Huỷ lượt. Resource là `room-booking`, KHÔNG phải `room` — cặp duy nhất lệch resource. */
  CANCEL: { action: "cancel", resourceType: "room-booking" },
  /** CRUD phòng · kích hoạt/vô hiệu · xoá mềm. */
  MANAGE: { action: "manage", resourceType: "room" },
} as const;

/**
 * Trạng thái hiển thị của một lượt đặt = trạng thái DB (`Confirmed`/`Cancelled`) **cộng** trạng thái
 * DẪN XUẤT `Completed` mà server tính (`isCompleted`, SPEC-14 §10 ROOM-FUNC-010). `Completed` KHÔNG
 * tồn tại trong DB và FE **không** tự suy từ đồng hồ máy — máy người dùng lệch giờ là đủ để một lượt
 * đang diễn ra bị vẽ thành đã xong (và mất nút Huỷ hợp lệ).
 */
export type RoomBookingDisplayStatus = RoomBookingStatusDto | "Completed";

export const ROOM_BOOKING_STATUS_I18N: Readonly<Record<RoomBookingDisplayStatus, string>> = {
  Confirmed: "status.confirmed",
  Completed: "status.completed",
  Cancelled: "status.cancelled",
};

/** Biến thể badge (shadcn) theo trạng thái hiển thị. */
export const ROOM_BOOKING_STATUS_VARIANT: Readonly<
  Record<RoomBookingDisplayStatus, "default" | "secondary" | "outline">
> = {
  Confirmed: "default",
  Completed: "secondary",
  Cancelled: "outline",
};

/** Trạng thái phòng ở màn quản trị 004 — hai giá trị, suy từ `isActive`. */
export const ROOM_ACTIVE_I18N = {
  active: "roomStatus.active",
  inactive: "roomStatus.inactive",
} as const;

// ── Lưới lịch (ROOM-SCREEN-001) ──────────────────────────────────────────────────────────────────

/**
 * Giờ đầu/cuối vẽ trên lưới. Cắt ở 07:00–21:00 thay vì 24 giờ: lưới 24 hàng làm mỗi ô cao ~28px trên
 * màn 1080p, không đọc được tiêu đề. Lượt NGOÀI khung vẫn tải về và **vẫn hiện** — kẹp vào hàng biên
 * kèm dấu hiệu tràn, KHÔNG lọc bỏ (lọc bỏ là giấu lịch bận ⇒ người dùng đặt đè rồi ăn 409).
 */
export const ROOM_GRID_START_HOUR = 7;
export const ROOM_GRID_END_HOUR = 21;
/** Độ phân giải chọn khung: 30 phút (bội của ROOM_BOOKING_MIN_MINUTES = 15). */
export const ROOM_GRID_SLOT_MINUTES = 30;

/** Hai chế độ xem của màn 001. `week` = 7 ngày, `day` = 1 ngày (cột = phòng ở CẢ HAI). */
export const ROOM_CALENDAR_VIEWS = ["day", "week"] as const;
export type RoomCalendarView = (typeof ROOM_CALENDAR_VIEWS)[number];

export const ROOM_VIEW_DAYS: Readonly<Record<RoomCalendarView, number>> = {
  day: 1,
  week: 7,
};

/**
 * Trần cửa sổ tra cứu của BE (`ROOM-ERR-002 range-too-wide`). Nhắc lại ở đây để màn 004 (tab lịch sử,
 * người dùng tự chọn khoảng) chặn TRƯỚC khi gọi thay vì để server ném 422 — cùng giá trị, import từ
 * contracts nên không drift.
 */
export const ROOM_HISTORY_MAX_DAYS = ROOM_WINDOW_MAX_DAYS;

/** Số ngày mặc định của tab «Lịch sử sử dụng» (màn 004): 30 ngày gần nhất (< trần 31). */
export const ROOM_USAGE_DEFAULT_DAYS = 30;

// ── Tab của «Đặt phòng của tôi» (ROOM-SCREEN-003) ────────────────────────────────────────────────

export const ME_BOOKING_TABS = ["upcoming", "past", "cancelled"] as const;
export type MeBookingTab = (typeof ME_BOOKING_TABS)[number];

/**
 * Cửa sổ mặc định của từng tab, tính bằng ngày quanh HÔM NAY: `[today − back, today + forward)` —
 * NỬA MỞ, nên `forward` là số ngày thực sự phủ về phía trước và ngày `today + forward` KHÔNG nằm trong.
 *
 * ⚠️ `back + forward` PHẢI ≤ `ROOM_WINDOW_MAX_DAYS` (31): BE ném 422 ROOM-ERR-002 `range-too-wide` khi
 * `to − from > 31 ngày` (`lookupWindowViolation`). Đây là lý do tab «Đã qua» dùng `forward: 1` chứ
 * không phải 0 — cần phủ trọn ngày HÔM NAY (lượt sáng nay đã kết thúc phải hiện ở «Đã qua»), và tab
 * «Đã huỷ» chia 15/16 chứ không 31/31.
 */
export const ME_TAB_DAYS: Readonly<Record<MeBookingTab, { back: number; forward: number }>> = {
  upcoming: { back: 0, forward: ROOM_WINDOW_MAX_DAYS },
  past: { back: ROOM_WINDOW_MAX_DAYS - 1, forward: 1 },
  cancelled: { back: 15, forward: 16 },
};

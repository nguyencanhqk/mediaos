/**
 * S11-ROOM-FE-1 — suy nút hành động của ROOM từ **DTO server ∩ quyền** (SPEC-14 §9 màn 005, §14).
 *
 * ⚠️ Nguyên tắc khác hẳn ASSET: ở ASSET, FE suy nút từ FSM (`status` + `counts`) vì server không gửi
 * cờ nào. Ở ROOM, server ĐÃ tính sẵn `canCancel` theo quyền + data_scope + thời gian (ROOM-FUNC-006) và
 * `isCompleted` theo `endsAt ≤ now` (ROOM-FUNC-010). **Dựng lại hai công thức đó trên FE là tạo nguồn
 * sự thật thứ hai**: hôm nay `cancel@Own ⇒ organizer === me` là đúng, nhưng scope là per-(permission,
 * role) nên một role tuỳ biến ở scope Company sẽ bị FE giấu mất nút mà server sẵn sàng cho huỷ. Và
 * `isCompleted` suy từ đồng hồ MÁY thì máy lệch giờ là đủ để mất nút Huỷ hợp lệ.
 *
 * Vế `useCan` vẫn cần ở chỗ CHƯA có DTO (nút «+ Đặt phòng» trên lưới, tab «Quản trị») — ở đó không có
 * lượt nào để mà đọc cờ.
 *
 * Hàm thuần, KHÔNG đụng react.
 */
import type { RoomBookingResponseDto, RoomResponseDto } from "@mediaos/contracts";
import type { RoomBookingDisplayStatus } from "./constants";

/** Lát cắt tối thiểu của `roomBookingResponseSchema` mà việc suy nút cần. */
export interface BookingActionSubject {
  readonly status: RoomBookingResponseDto["status"];
  readonly isCompleted: boolean;
  readonly canCancel: boolean;
}

/**
 * Trạng thái HIỂN THỊ của một lượt (SPEC-01 §17.10 + SPEC-14 §10 ROOM-FUNC-010).
 *
 * `Cancelled` thắng `isCompleted`: một lượt bị huỷ rồi trôi qua giờ kết thúc vẫn là "Đã huỷ", không
 * phải "Đã diễn ra". Server đã đặt `isCompleted = status === 'Confirmed' ∧ endsAt ≤ now` nên hai cờ
 * không thể cùng bật — thứ tự ở đây là hàng rào thứ hai, không phải chỗ sửa dữ liệu.
 */
export function bookingDisplayStatus(b: BookingActionSubject): RoomBookingDisplayStatus {
  if (b.status === "Cancelled") return "Cancelled";
  return b.isCompleted ? "Completed" : "Confirmed";
}

/**
 * Có hiện nút «Huỷ» cho lượt này không.
 *
 * `canCancel` của server là điều kiện ĐỦ về nghiệp vụ (quyền + scope + `endsAt > now` + chưa huỷ).
 * `hasCancelPermission` (từ `useCan("cancel", "room-booking")`) là hàng rào NAV: nó chỉ nói "người này
 * có cặp quyền huỷ ở đâu đó", không nói gì về lượt cụ thể. Hai vế AND với nhau, và vế server là vế
 * quyết định — nếu server nói `false` thì dù có quyền cũng không hiện (nút đó chắc chắn ăn 409/403,
 * đúng cái SPEC-14 §9 màn 005 cấm: "không hiện nút mà server sẽ trả 409/403").
 */
export function canShowCancelButton(
  b: BookingActionSubject,
  hasCancelPermission: boolean,
): boolean {
  return hasCancelPermission && b.canCancel;
}

/**
 * Phòng có nhận đặt không — dùng để lọc dropdown của form đặt (SPEC-14 §9 màn 002) khi nguồn là
 * `GET /rooms` (chưa chọn khung giờ nên chưa gọi được `/rooms/availability`).
 *
 * Hai điều kiện của ROOM-ERR-004: `isActive` VÀ KHÔNG `requiresApproval` (ROOM-DEC-002 — v1 chưa có
 * luồng duyệt). Bỏ vế `requiresApproval` là dựng một mục chọn được rồi ăn 409 `approval-not-supported`.
 */
export function isRoomBookable(
  room: Pick<RoomResponseDto, "isActive" | "requiresApproval">,
): boolean {
  return room.isActive && !room.requiresApproval;
}

/**
 * Có hiện nút vô hiệu/xoá phòng không (màn 004).
 *
 * `upcomingCount` CHỈ có ở chi tiết `GET /rooms/:id` (contracts khai `.optional()`) — ở danh sách nó
 * VẮNG KHOÁ. `undefined` ⇒ **vẫn hiện nút**: chưa biết thì không được đoán là "còn lịch". Server chặn
 * bằng ROOM-ERR-008 kèm `upcomingCount` thật, và UI hiện đúng con số đó. Đoán ngược lại (ẩn nút khi
 * không biết) sẽ khoá cứng thao tác hợp lệ ở màn danh sách, nơi khoá này luôn vắng.
 */
export function canDeactivateRoom(room: Pick<RoomResponseDto, "upcomingCount">): boolean {
  return room.upcomingCount === undefined || room.upcomingCount === 0;
}

/** Số người của một lượt: organizer NGẦM ĐỊNH là người tham dự (SPEC-14 §12), không nằm trong mảng. */
export function headcountOf(attendeeCount: number): number {
  return 1 + attendeeCount;
}

/**
 * Sức chứa còn đủ cho `attendeeCount` người tham dự không — cảnh báo TRƯỚC ở form (ROOM-ERR-007).
 * `capacity` là của phòng đang chọn; chưa chọn phòng ⇒ `null` ⇒ không cảnh báo (chưa đủ dữ kiện).
 */
export function exceedsCapacity(capacity: number | null, attendeeCount: number): boolean {
  if (capacity === null) return false;
  return headcountOf(attendeeCount) > capacity;
}

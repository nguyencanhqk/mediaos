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

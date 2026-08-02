import { UnprocessableEntityException } from "@nestjs/common";
import type { ChatRoomType } from "../db/schema/communication";
import { CHAT_ERR } from "./chat.errors";

/**
 * S7-CHAT-BE-1 — luật NGHIỆP VỤ theo LOẠI/TRẠNG THÁI phòng (SPEC-15 §3.1 · §12).
 *
 * ⚠️ ĐÂY KHÔNG PHẢI lớp membership. Mọi hàm dưới đây là HÀM THUẦN chỉ đọc `roomType`/`isArchived` của
 * một phòng mà `ChatAccessService.assertMember` ĐÃ trả về. Không hàm nào truy vấn DB, không hàm nào
 * quyết định "actor có được vào phòng này không" — nếu có, đó là điểm khẳng định membership THỨ HAI và
 * là đúng thứ WO này tồn tại để không có.
 *
 * SPEC-15 §3.1: chỉ `group` có cơ chế thành viên THỦ CÔNG. `department`/`project` là thành viên DẪN XUẤT
 * (cache đồng bộ từ HR/TASK — `S7-CHAT-BE-5`); `direct` cố định đúng 2 người.
 */

interface RoomShape {
  roomType: ChatRoomType;
  isArchived: boolean;
}

/** Thêm/bớt/đổi vai trò thành viên — chỉ phòng `group` (CHAT-ERR-012). */
export function assertManualMembership(room: RoomShape): void {
  if (room.roomType !== "group") {
    throw new UnprocessableEntityException(CHAT_ERR.MANUAL_MEMBER_BLOCKED(room.roomType));
  }
}

/** Sửa tên/mô tả, lưu trữ — cũng là thao tác thủ công, chỉ phòng `group` (CHAT-ERR-012). */
export function assertManualEdit(room: RoomShape): void {
  if (room.roomType !== "group") {
    throw new UnprocessableEntityException(CHAT_ERR.MANUAL_EDIT_BLOCKED(room.roomType));
  }
}

/**
 * Phòng đã lưu trữ = CHỈ ĐỌC (API-13 CHAT-API-006 "chỉ đọc sau đó"), chặn CHAT-ERR-005.
 *
 * ⚠️ CỐ Ý KHÔNG áp cho `leave`: rời phòng là thao tác trên tư cách thành viên CỦA CHÍNH MÌNH, không phải
 * trên nội dung/cấu hình phòng. Chặn cả lối đó thì người dùng bị nhốt vĩnh viễn trong một phòng đã đóng —
 * không admin nào còn động vào được để bớt họ ra (mọi đường ghi thành viên đã bị khoá bởi chính luật này).
 */
export function assertNotArchived(room: RoomShape): void {
  if (room.isArchived) {
    throw new UnprocessableEntityException(CHAT_ERR.ROOM_ARCHIVED);
  }
}

/** Tự rời — chỉ phòng `group` (SPEC-15 §3.1 · CHAT-ERR-013). */
export function assertLeavable(room: RoomShape): void {
  if (room.roomType !== "group") {
    throw new UnprocessableEntityException(CHAT_ERR.LEAVE_BLOCKED(room.roomType));
  }
}

/** `direct_key` = 2 userId **sort tăng dần**, join ':' — cùng cặp người ⇒ cùng khoá, bất kể ai mở trước. */
export function buildDirectKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

/**
 * Số tin chưa đọc của MỘT phòng (SPEC-15 §13.2). Cả hai vế trong hệ `room_seq` PER-ROOM (mig `0539`) —
 * KHÔNG phải `chat_messages.seq` (identity cấp BẢNG; phép trừ trên nó ra tổng số tin TOÀN HỆ THỐNG giữa
 * hai mốc, đo thật 51 thay vì 1, và làm lộ lưu lượng của phòng mình không thuộc).
 *
 * ⚠️ CÔNG THỨC NÀY CÓ HAI BẢN: bản JS ở đây (đường đọc một phòng) và bản SQL trong
 * `ChatRoomsRepository.listRoomsForUser` (đường danh sách, phải nằm trong truy vấn để không N+1). Sửa
 * một bên PHẢI sửa bên kia — chúng phải cho cùng con số trên cùng dữ liệu.
 *
 * `?? 0` cho `lastMessageSeq`: NULL = phòng chưa có tin nào (`0538` không đặt DEFAULT). Bỏ qua là trả
 * `unreadCount: null` ⇒ ZodError ở FE dù HTTP 200. `Math.max(0, …)` chặn số âm khi con trỏ đã đọc vượt.
 */
export function unreadOf(lastMessageSeq: number | null, lastReadSeq: number): number {
  return Math.max(0, (lastMessageSeq ?? 0) - lastReadSeq);
}

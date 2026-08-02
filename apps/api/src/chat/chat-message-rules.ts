import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ChatMessageAccess } from "./chat-access.service";
import { CHAT_ERR } from "./chat.errors";

/**
 * S7-CHAT-BE-2 — luật nghiệp vụ của TIN NHẮN (SPEC-15 §13.1 · §13.2 · §13.6 · §12).
 *
 * Hàm thuần, không truy vấn. Mọi hàm nhận kết quả `ChatAccessService.assertMessageAccess` ĐÃ chạy —
 * chúng quyết định "được làm gì với tin này", KHÔNG quyết định "có được vào phòng không".
 */

/**
 * Cửa sổ thu hồi của NGƯỜI GỬI (SPEC-15 §13.6). **MỘT chỗ duy nhất** — spec ghi rõ "hằng số cấu hình,
 * không hard-code rải rác": rải ra nhiều nơi thì sửa một chỗ, ba chỗ còn lại âm thầm giữ luật cũ và
 * không test nào bắt được vì mỗi đường đi qua một hằng khác nhau.
 */
export const CHAT_RECALL_WINDOW_MINUTES = 15;

/** Trần ghim mỗi phòng (SPEC-15 §12 CHAT-ERR-008). */
export const CHAT_PIN_MAX_PER_ROOM = 20;

/** Trần một trang tin (API-13 §5.1). Ép ở Zod; hằng này để repo và test nói cùng một số. */
export const CHAT_MESSAGE_PAGE_MAX = 100;

/**
 * Tin `system` (server sinh) và tin ĐÃ THU HỒI không phải đối tượng của ghim.
 * Ghim tin đã thu hồi = ghim một ô trống lên đầu phòng; ghim tin hệ thống = ghim tiếng ồn.
 */
export function assertPinnable(access: ChatMessageAccess): void {
  if (access.message.messageType === "system" || access.message.recalledAt) {
    throw new UnprocessableEntityException(CHAT_ERR.MESSAGE_NOT_ACTIONABLE);
  }
}

/**
 * Ai thu hồi được (SPEC-15 §13.6):
 *   • người gửi, trong `CHAT_RECALL_WINDOW_MINUTES` kể từ `created_at`;
 *   • **hoặc** admin của phòng **NHÓM** — admin phòng dẫn xuất (`department`/`project`) KHÔNG tính:
 *     vai trò ở đó là cache đồng bộ từ HR/TASK, không phải uỷ quyền kiểm duyệt do người chọn.
 *
 * MỘT thông điệp cho mọi vế từ chối: tách "không phải tin của bạn" khỏi "đã quá hạn" là nói cho người
 * ngoài biết tin đó của ai.
 */
export function assertCanRecall(access: ChatMessageAccess, now: Date): void {
  if (access.message.messageType === "system") {
    throw new UnprocessableEntityException(CHAT_ERR.MESSAGE_NOT_ACTIONABLE);
  }

  const isRoomAdmin = access.membership.role === "admin" && access.room.roomType === "group";
  if (isRoomAdmin) return;

  const isSender = access.message.senderId === access.membership.userId;
  const ageMs = now.getTime() - access.message.createdAt.getTime();
  const withinWindow = ageMs <= CHAT_RECALL_WINDOW_MINUTES * 60_000;
  if (isSender && withinWindow) return;

  throw new ForbiddenException(CHAT_ERR.RECALL_DENIED(CHAT_RECALL_WINDOW_MINUTES));
}

/** Vượt trần ghim → 409 (xung đột với trạng thái hiện tại của phòng, không phải body sai). */
export function assertPinBudget(currentPinned: number): void {
  if (currentPinned >= CHAT_PIN_MAX_PER_ROOM) {
    throw new ConflictException(CHAT_ERR.PIN_LIMIT(CHAT_PIN_MAX_PER_ROOM));
  }
}

/**
 * `beforeSeq` và `afterSeq` LOẠI TRỪ NHAU (CHAT-ERR-016). Gửi cả hai không phải "ưu tiên cái nào" —
 * là câu hỏi vô nghĩa, và đoán hộ sẽ trả về trang tin mà client không hề yêu cầu.
 */
export function assertCursorExclusive(beforeSeq?: number, afterSeq?: number): void {
  if (beforeSeq !== undefined && afterSeq !== undefined) {
    throw new UnprocessableEntityException(CHAT_ERR.CURSOR_EXCLUSIVE);
  }
}

/**
 * Con trỏ đã đọc CHỈ TIẾN và không vượt thực tế (SPEC-15 §13.2 · CHAT-ERR-018).
 *
 * Hai vế, mỗi vế bịt một lỗi khác nhau:
 *   • `Math.max(current, wanted)` — thiết bị chậm không kéo lùi trạng thái của thiết bị nhanh;
 *   • kẹp trần `lastMessageSeq` — client không tự đẩy con trỏ vượt số tin thật để "dọn" badge; nếu cho
 *     vượt thì tin gửi SAU đó sẽ bị tính là đã đọc mà người dùng chưa hề thấy.
 * Cả hai đều IM LẶNG (không lỗi): đây là đường chạy mỗi lần cuộn, báo lỗi ở đây chỉ tạo nhiễu.
 */
export function clampReadCursor(
  wanted: number,
  current: number,
  lastMessageSeq: number | null,
): number {
  const ceiling = lastMessageSeq ?? 0;
  return Math.max(current, Math.min(wanted, ceiling));
}

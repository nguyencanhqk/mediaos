import type { ChatRoomDetailDto, ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import type { ChatMemberRole } from "../db/schema/communication";
import type { ChatMemberListRow } from "./chat-rooms.repository";

/**
 * Tập cột TỐI THIỂU để dựng `ChatRoomDto`. Khai structural (không phải union của các row cụ thể) để cả
 * `ChatRoomListRow`, `ChatRoomRow` lẫn `ChatRoomAccess['room']` đều dùng được mà KHÔNG cần `as` — mỗi
 * chỗ ép kiểu là một chỗ TypeScript thôi kiểm tra hộ.
 */
export interface ChatRoomProjection {
  id: string;
  companyId: string;
  refId: string | null;
  roomType: ChatRoomDto["roomType"];
  name: string | null;
  roomCode: string;
  description: string | null;
  lastMessageAt: Date | null;
  lastMessageSeq: number | null;
  isArchived: boolean;
  createdAt: Date;
}

/**
 * S7-CHAT-BE-1 — projection row Drizzle → DTO contracts. CẤM controller/service trả row thô.
 *
 * Vì sao có lớp này dù row trông đã "gần đúng": row còn cả cột KHÔNG được ra ngoài (`directKey` — ghép
 * từ 2 userId nên nó là quan hệ ai-nhắn-với-ai, `deletedAt`, `archivedBy`, …). Trả `...row` là rò những
 * cột đó theo mặc định, và mỗi cột thêm vào bảng sau này lại tự động rò tiếp.
 */

const toIso = (v: Date | string | null): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

const EPOCH = new Date(0).toISOString();

export function toChatRoomDto(
  row: ChatRoomProjection & { unreadCount?: number },
  unreadCount?: number,
): ChatRoomDto {
  return {
    id: row.id,
    companyId: row.companyId,
    refId: row.refId,
    roomType: row.roomType,
    // NULLABLE có chủ đích: phòng `direct` không có tên (mig 0538 DROP NOT NULL) — client dựng tên từ
    // 2 người. Ép `?? ""` ở đây là làm FE hiển thị phòng trống tên thay vì tên người đối thoại.
    name: row.name,
    roomCode: row.roomCode,
    description: row.description,
    lastMessageAt: toIso(row.lastMessageAt),
    lastMessageSeq: row.lastMessageSeq,
    isArchived: row.isArchived,
    // `?? 0` là lưới cuối, KHÔNG phải nơi tính: mọi caller đều đưa số vào — hoặc qua tham số
    // (`unreadOf`, đường đọc một phòng) hoặc qua cột `unreadCount` của câu SELECT (đường danh sách).
    // Giữ lưới vì `unreadCount: null` làm FE ăn ZodError = TRẮNG TRANG, tệ hơn hẳn một badge sai.
    unreadCount: unreadCount ?? row.unreadCount ?? 0,
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

export function toChatMemberDto(row: ChatMemberListRow): ChatRoomMemberDto {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    userName: row.userName,
    role: row.role,
    joinedAt: toIso(row.joinedAt) ?? EPOCH,
    lastReadSeq: row.lastReadSeq,
  };
}

export function toChatRoomDetailDto(
  room: ChatRoomProjection,
  members: ChatMemberListRow[],
  myRole: ChatMemberRole,
  unreadCount: number,
): ChatRoomDetailDto {
  return {
    ...toChatRoomDto(room, unreadCount),
    members: members.map(toChatMemberDto),
    myRole,
  };
}

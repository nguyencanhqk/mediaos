import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatRoomDetailDto,
  ChatRoomDto,
  ChatRoomMemberDto,
} from "@mediaos/contracts";
import type { ChatMemberRole } from "../db/schema/communication";
import type { ChatMemberListRow } from "./chat-rooms.repository";
import type { ChatMessageRow } from "./chat-messages.repository";

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

/**
 * S7-CHAT-BE-2 — row tin nhắn → DTO. **ĐÂY là lớp che của thu hồi** (SPEC-15 §13.6 · CLAUDE.md §5):
 * `recalled_at IS NOT NULL` ⇒ `body: null`. Bản gốc vẫn nằm trong DB (append-only, cho tranh chấp nội
 * bộ) nhưng KHÔNG rời server. Che ở client là không che gì cả — payload vẫn đi qua dây.
 *
 * Và đây là chỗ `seq` toàn cục bị chặn: repo không select nó, mapper không có khoá nào cho nó. Hai lớp
 * chứ không một, vì thêm cột vào `MESSAGE_COLUMNS` là việc dễ làm lúc vội.
 */
export function toChatMessageDto(
  row: ChatMessageRow,
  /**
   * S7-CHAT-BE-3 — tệp ĐÃ qua `FilePolicyService` và đã ký URL (`ChatAttachmentPresignService`).
   *
   * THAM SỐ BẮT BUỘC, không optional với mặc định `[]`: caller mới quên truyền sẽ được TypeScript chặn
   * thay vì âm thầm trả về tin "không có tệp" — cùng lý do `findMessageForDto` bắt buộc `visibleFromSeq`.
   * Mapper KHÔNG tự đi lấy tệp: lấy tệp cần ký, ký cần transaction riêng, và mapper là hàm thuần.
   */
  attachments: ChatAttachmentDto[],
): ChatMessageDto {
  const recalled = row.recalledAt !== null;
  return {
    id: row.id,
    companyId: row.companyId,
    roomId: row.roomId,
    senderId: row.senderId,
    senderName: row.senderName,
    body: recalled ? null : row.body,
    messageType: row.messageType,
    // S7-CHAT-CLEAN-1 (mig 0542): `fileUrl`/`fileName` đã rời cả DTO lẫn DB — không còn gì để trả.
    // Tin đã thu hồi không còn ai để nhắc tới: giữ mentions là gửi thông báo về một nội dung đã rút.
    mentions: recalled ? [] : row.mentions,
    pinnedAt: toIso(row.pinnedAt),
    pinnedBy: row.pinnedBy,
    replyToMessageId: row.replyToMessageId,
    recalledAt: toIso(row.recalledAt),
    attachmentCount: row.attachmentCount,
    // Tin đã thu hồi: tệp biến mất khỏi DTO — cùng lớp che với `body`/`mentions` (SPEC-15 §13.6). Link
    // của chúng đã soft-delete nên truy vấn vốn đã trả rỗng; đây là ĐAI THỨ HAI, đặt ngay cạnh hai luật
    // che kia để không ai tách chúng ra. `attachmentCount` CỐ Ý giữ số cũ (cột không có GRANT UPDATE) —
    // nó là số liệu lịch sử, không phải nguồn để render.
    attachments: recalled ? [] : attachments,
    roomSeq: row.roomSeq,
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

import type {
  ChatAttachmentDto,
  ChatCallDto,
  ChatMessageDto,
  ChatMessageReactionDto,
  ChatRoomDetailDto,
  ChatRoomDto,
  ChatRoomLastMessageDto,
  ChatRoomMemberDto,
  ChatRoomPeerDto,
} from "@mediaos/contracts";
import type { ChatCallKind, ChatCallStatus, ChatMemberRole } from "../db/schema/communication";
import type { ChatCallParticipantRow } from "./chat-calls.repository";
import type { ChatMemberListRow, ChatRosterRow } from "./chat-rooms.repository";
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
 * S8-CHAT-UX-BE-1 — ba tuỳ chọn PER-USER đi kèm một phòng, lấy từ hàng `chat_room_members` CỦA CHÍNH
 * người gọi (`assertMember().membership` hoặc cột join sẵn của `listRoomsForUser`).
 *
 * THAM SỐ RIÊNG, không nhét vào `ChatRoomProjection`: projection là hình dạng của PHÒNG (dùng chung cho
 * mọi người nhìn), ba cột này là của MỘT NGƯỜI. Trộn hai thứ vào một kiểu là mở đường cho một caller
 * tương lai lấy `pinnedAt` của người khác rồi phát cho cả phòng — đúng loại lỗi mà `broadcastRoom` đã
 * phải chặn bằng `wsChatRoomEventSchema` cho `unreadCount`.
 */
export interface ChatRoomMemberPrefs {
  pinnedAt: Date | null;
  mutedUntil: Date | null;
  markedUnreadAt: Date | null;
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
  row: ChatRoomProjection & { unreadCount?: number } & Partial<ChatRoomMemberPrefs>,
  unreadCount?: number,
  /**
   * S8-CHAT-UX-BE-1 — tuỳ chọn per-user. OPTIONAL vì hai đường nạp khác nhau, không phải vì "được
   * phép quên": đường DANH SÁCH (`listRoomsForUser`) đã có sẵn ba cột TRÊN `row` (join membership),
   * đường MỘT PHÒNG truyền chúng vào đây từ `assertMember().membership`. Tham số thắng `row`.
   */
  prefs?: ChatRoomMemberPrefs,
  /**
   * S8-CHAT-UX-BE-2 — URL avatar phòng ĐÃ KÝ, do `ChatRoomAvatarPresignService` cấp theo LÔ.
   *
   * Mapper KHÔNG tự đi lấy: lấy cần truy vấn, ký cần storage adapter, còn mapper là hàm THUẦN — cùng
   * lý do `toChatMessageDto` bắt caller truyền `attachments`/`reactions` vào.
   *
   * Mặc định `null` (không phải `undefined`): thiếu khoá thì JSON nuốt mất trường và FE không phân
   * biệt được "server chưa có tính năng" với "phòng chưa đặt ảnh".
   */
  avatarUrl: string | null = null,
  /**
   * S17-CHAT-UX2-BE-1 — hai khoá v2 (CHAT-DEC-022/023). **THAM SỐ CUỐI**, không chèn vào giữa: ba spec
   * dựng `ChatRoomsService`/`ChatMembersService` bằng THỨ TỰ THAM SỐ và mọi lời gọi `toChatRoomDto`
   * hiện có đang truyền 4 vị trí đầu.
   *
   * Mặc định `{}` ⇒ hai khoá ra `null`, KHÔNG phải `undefined`: `undefined` biến mất khỏi JSON và FE
   * không phân biệt được "server chưa có tính năng" với "phòng chưa có tin" — cùng lý do `avatarUrl`
   * mặc định `null`. Ba đường broadcast (`updateRoom`/`archiveRoom`/`createGroup`) cố ý KHÔNG truyền
   * tham số này: payload WS không mang preview của một thời điểm khác thời điểm người nhận đọc nó.
   */
  extra: { lastMessage?: ChatRoomLastMessageDto | null; peer?: ChatRoomPeerDto | null } = {},
): ChatRoomDto {
  const p = prefs ?? row;
  return {
    avatarUrl,
    lastMessage: extra.lastMessage ?? null,
    peer: extra.peer ?? null,
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
    // `?? null` chứ KHÔNG bỏ khoá khi thiếu: `undefined` biến mất khỏi JSON ⇒ FE không phân biệt được
    // "server chưa có tính năng" với "chưa ghim". `null` nói đúng một điều: chưa đặt.
    pinnedAt: toIso(p.pinnedAt ?? null),
    mutedUntil: toIso(p.mutedUntil ?? null),
    markedUnreadAt: toIso(p.markedUnreadAt ?? null),
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
  /**
   * S8-CHAT-UX-BE-3 — tổng hợp cảm xúc của tin này. **THAM SỐ BẮT BUỘC**, cùng lý do với `attachments`:
   * caller mới quên truyền sẽ vỡ typecheck thay vì âm thầm trả tin "không ai thả cảm xúc".
   */
  reactions: ChatMessageReactionDto[],
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
    // Tin đã thu hồi: cảm xúc biến mất khỏi DTO — CÙNG lớp che với `body`/`mentions`/`attachments`
    // (SPEC-15 §13.6). Hàng vẫn nằm trong `chat_message_reactions` (không xoá dữ liệu vì một thao tác
    // hiển thị), nhưng để lại phản ứng dưới một nội dung đã rút là hiện đúng thứ người gửi vừa gỡ.
    reactions: recalled ? [] : reactions,
    roomSeq: row.roomSeq,
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

/**
 * S17-CHAT-UX2-BE-1 — `chatRoomSchema.peer` từ một hàng của `listRoomsForUser` (CHAT-DEC-023).
 *
 * `null` khi LATERAL không khớp: phòng KHÔNG phải `direct`, hoặc DM lệch dữ liệu không còn hàng
 * membership nào của người kia. FE dựng tên phòng theo đường cũ trong cả hai ca.
 *
 * ⚠️ **KHÔNG đọc `row.peerAvatarRaw`, và không được sửa để đọc nó.** Cột `employee_profiles.avatar_url`
 * ĐA-NGƯỜI-GHI và có thể bị đầu độc trỏ tệp bất kỳ trong tenant; chỉ URL đã đi qua
 * `AvatarPresignService.resolveEmployeeAvatars` (xác minh cặp `(employeeId, fileId)` rồi mới ký) mới
 * được lên DTO. Mirror `toChatRosterMemberDto`.
 *
 * ⚠️ `isActive` `?? false` chứ không `?? true`: hàng NULL ở đây nghĩa là không xác định được tư cách,
 * và mặc-định-đang-hoạt-động là fail-OPEN của một chỉ báo hiển thị — nhãn «Ngừng hoạt động» vắng mặt
 * đúng lúc nó cần có. Thực tế `peerIsActiveExpr()` luôn trả boolean khi có hàng peer, nên nhánh này chỉ
 * là lưới cuối.
 */
export function toChatRoomPeerDto(
  row: {
    roomType: ChatRoomDto["roomType"];
    peerUserId: string | null;
    peerName: string | null;
    peerIsActive: boolean | null;
    peerEmployeeId: string | null;
  },
  signedAvatarByEmployee: ReadonlyMap<string, string>,
): ChatRoomPeerDto | null {
  if (row.roomType !== "direct" || row.peerUserId === null) return null;
  return {
    userId: row.peerUserId,
    name: row.peerName,
    avatarUrl:
      row.peerEmployeeId === null ? null : (signedAvatarByEmployee.get(row.peerEmployeeId) ?? null),
    isActive: row.peerIsActive ?? false,
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

/**
 * S8-CHAT-UX-FE-3 — một hàng **ROSTER** (CHAT-API-007a · CHAT-DEC-019).
 *
 * ⚠️ `avatarUrl` nhận URL **ĐÃ KÝ** do caller truyền vào, KHÔNG phải `row.avatarRaw`. Đưa giá trị thô của
 * `employee_profiles.avatar_url` lên DTO là bỏ qua toàn bộ lớp xác minh cặp `(employeeId, fileId)` mà
 * `AvatarPresignService` tồn tại để làm — cột đó ĐA-NGƯỜI-GHI và có thể bị đầu độc trỏ tệp bất kỳ trong
 * tenant. Vì thế hàm này KHÔNG đọc `row.avatarRaw`, và không được sửa để đọc nó.
 *
 * `isOnline` LUÔN có mặt (boolean, không `undefined`): "không biết" và "không online" hiển thị giống
 * nhau, nên gửi một giá trị dứt khoát tránh việc FE phải đoán ý nghĩa của khoá vắng.
 */
export function toChatRosterMemberDto(
  row: ChatRosterRow,
  signedAvatarUrl: string | null,
  isOnline: boolean,
): ChatRoomMemberDto {
  return {
    ...toChatMemberDto(row),
    avatarUrl: signedAvatarUrl,
    isOnline,
    leftAt: toIso(row.leftAt),
  };
}

/**
 * Tập cột TỐI THIỂU để dựng `ChatCallDto`. Khai structural — cùng lý do `ChatRoomProjection`: hàng từ
 * `ChatCallsRepository` (drizzle `$inferSelect`) và hàng từ `ChatAccessService.assertCallAccess` đều
 * dùng được mà KHÔNG cần `as`.
 */
export interface ChatCallProjection {
  id: string;
  roomId: string;
  initiatorUserId: string;
  kind: ChatCallKind;
  status: ChatCallStatus;
  startedAt: Date | string;
  acceptedAt: Date | string | null;
  endedAt: Date | string | null;
}

/**
 * S7-CALL-BE-1 — `ChatCallDto` (`chatCallSchema`, `packages/contracts/src/chat-call.ts`).
 *
 * `participants` LUÔN được truyền (mảng rỗng cũng là mảng): schema để `.optional()` cho đường đọc tương
 * lai, nhưng mọi phản hồi vòng đời đều vừa ghi xong bảng đó trong CÙNG tx nên bỏ trống chỉ tạo ra một
 * hình dạng thứ hai mà FE phải phòng thủ.
 *
 * ⚠️ KHÔNG có trường nào cho SDP/ICE/nội dung media ở đây, và không được thêm: hàng rào **R3** của
 * `CHAT-DEC-020` nói server không đọc, không lưu tín hiệu. Đưa chúng lên DTO là lưu, chỉ đổi chỗ.
 */
export function toChatCallDto(call: ChatCallProjection, participants: ChatCallParticipantRow[]) {
  return {
    id: call.id,
    roomId: call.roomId,
    initiatorUserId: call.initiatorUserId,
    kind: call.kind,
    status: call.status,
    startedAt: toIso(call.startedAt) ?? EPOCH,
    acceptedAt: toIso(call.acceptedAt),
    endedAt: toIso(call.endedAt),
    participants: participants.map((p) => ({
      userId: p.userId,
      invitedAt: toIso(p.invitedAt) ?? EPOCH,
      joinedAt: toIso(p.joinedAt),
      leftAt: toIso(p.leftAt),
      outcome: p.outcome,
    })),
  } satisfies ChatCallDto;
}

export function toChatRoomDetailDto(
  room: ChatRoomProjection,
  members: ChatMemberListRow[],
  myRole: ChatMemberRole,
  unreadCount: number,
  /** S8-CHAT-UX-BE-1 — BẮT BUỘC: caller luôn có `assertMember().membership` trong tay ở đường này. */
  prefs: ChatRoomMemberPrefs,
  /** S8-CHAT-UX-BE-2 — URL avatar đã ký (xem `toChatRoomDto`). `null` = chưa đặt / không hợp lệ. */
  avatarUrl: string | null = null,
  /**
   * S17-CHAT-UX2-BE-1 — họ tên người tạo phòng, cho dòng «Tạo bởi … · ngày» (CHAT-DEC-025).
   *
   * `null` = phòng do HỆ THỐNG dựng (`department`/`project` — `chat_rooms.created_by` nullable) hoặc
   * không tra được hàng `users`. Caller truyền vào; mapper KHÔNG tự đi lấy (hàm THUẦN, mirror
   * `attachments`/`reactions` của `toChatMessageDto`).
   */
  createdByName: string | null = null,
): ChatRoomDetailDto {
  return {
    ...toChatRoomDto(room, unreadCount, prefs, avatarUrl),
    members: members.map(toChatMemberDto),
    myRole,
    createdByName,
  };
}

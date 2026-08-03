import type {
  ChatOversightAttachmentDto,
  ChatOversightAuditEntryDto,
  ChatOversightMessageDto,
  ChatOversightRoomDetailDto,
  ChatOversightRoomSummaryDto,
  ChatRoomMemberDto,
} from "@mediaos/contracts";
import type { ChatMemberRole } from "../db/schema/communication";
import type { ChatAttachmentRow } from "./chat-attachments.repository";
import { isImageMimeType } from "./chat-file.constants";
import type {
  ChatOversightAuditRow,
  ChatOversightMessageRow,
  ChatOversightRoomRow,
} from "./chat-oversight.repository";

/**
 * S7-CHAT-BE-7 🔒 — projection row → DTO cho ĐƯỜNG ĐỌC-VƯỢT (API-13 §5.3).
 *
 * ┌─ VÌ SAO MAPPER RIÊNG, KHÔNG DÙNG `chat.mapper.ts` ────────────────────────────────────────────────┐
 * │ `toChatMessageDto` nhận `attachments: ChatAttachmentDto[]` — hình dạng ĐÃ KÝ URL                   │
 * │ (`ChatAttachmentPresignService`). Gọi nó ở đây thì hoặc phải ký URL (⇒ oversight tự phát khoá đọc  │
 * │ tệp KHÔNG CẦN MEMBERSHIP — ràng buộc 7 vỡ), hoặc phải truyền `[]` (⇒ payload nói dối: tin CÓ tệp   │
 * │ mà hiện 0 tệp). Cả hai đều sai; đường thứ ba là mapper riêng trả **metadata thuần**.                │
 * │                                                                                                     │
 * │ `toChatRoomDetailDto` thì đòi `myRole` — người đọc-vượt KHÔNG có hàng `chat_room_members` nào, nên  │
 * │ mọi giá trị điền vào đó là bịa, và một FE đọc `myRole === 'admin'` sẽ bật nút quản trị trên phòng   │
 * │ mà BE luôn 403.                                                                                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Mọi hàm ở đây liệt kê khoá TƯỜNG MINH — không `...row`. Row của repo mang `storagePath` (cột KHÔNG
 * BAO GIỜ ra khỏi server, CLAUDE.md §2.3) và `body` gốc của tin đã thu hồi; trải nguyên row là rò cả hai.
 * `.parse()` qua schema oversight ở controller là ĐAI THỨ HAI, không phải đai duy nhất.
 */

const toIso = (v: Date | string | null): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

const EPOCH = new Date(0).toISOString();

export function toOversightRoomSummaryDto(row: ChatOversightRoomRow): ChatOversightRoomSummaryDto {
  return {
    id: row.id,
    roomCode: row.roomCode,
    name: row.name,
    roomType: row.roomType,
    isArchived: row.isArchived,
    memberCount: row.memberCount,
    lastMessageAt: toIso(row.lastMessageAt),
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

export function toOversightRoomDetailDto(
  row: ChatOversightRoomRow,
  members: Array<{
    id: string;
    roomId: string;
    userId: string;
    userName: string | null;
    role: string;
    joinedAt: Date;
    lastReadSeq: number;
  }>,
): ChatOversightRoomDetailDto {
  return {
    ...toOversightRoomSummaryDto(row),
    description: row.description,
    members: members.map(
      (m): ChatRoomMemberDto => ({
        id: m.id,
        roomId: m.roomId,
        userId: m.userId,
        userName: m.userName,
        role: m.role as ChatMemberRole,
        joinedAt: toIso(m.joinedAt) ?? EPOCH,
        lastReadSeq: m.lastReadSeq,
      }),
    ),
  };
}

/**
 * Đính kèm → **metadata thuần**. KHÔNG `url`, KHÔNG `thumbnailUrl`, KHÔNG `storagePath`.
 *
 * `linkId` cũng bị bỏ có chủ đích: nó là khoá của hàng `file_links`, chỉ hữu ích cho thao tác GHI (gỡ
 * link) — thứ đường oversight không có và sẽ không bao giờ có (ràng buộc 4).
 */
export function toOversightAttachmentDto(row: ChatAttachmentRow): ChatOversightAttachmentDto {
  return {
    fileId: row.fileId,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    isImage: isImageMimeType(row.mimeType),
  };
}

/**
 * Tin → DTO oversight. **Lớp che của thu hồi được GIỮ NGUYÊN** (`recalled_at IS NOT NULL` ⇒ `body: null`,
 * `mentions: []`, `attachments: []`).
 *
 * ⚠️ CHAT-DEC-004 mở ranh giới MEMBERSHIP, KHÔNG mở lớp masking của SPEC-15 §13.6. Bản gốc vẫn nằm trong
 * DB (append-only, cho tranh chấp nội bộ) và đường lấy nó là truy vấn DBA có kiểm soát — không phải một
 * endpoint HTTP. Bỏ vế này ở đây là cấp một năng lực mới mà không ai chốt, trên đúng bề mặt rủi ro nhất
 * của module.
 */
export function toOversightMessageDto(
  row: ChatOversightMessageRow,
  attachments: ChatOversightAttachmentDto[],
): ChatOversightMessageDto {
  const recalled = row.recalledAt !== null;
  return {
    id: row.id,
    roomId: row.roomId,
    senderId: row.senderId,
    senderName: row.senderName,
    body: recalled ? null : row.body,
    messageType: row.messageType,
    mentions: recalled ? [] : row.mentions,
    pinnedAt: toIso(row.pinnedAt),
    replyToMessageId: row.replyToMessageId,
    recalledAt: toIso(row.recalledAt),
    attachmentCount: row.attachmentCount,
    attachments: recalled ? [] : attachments,
    roomSeq: row.roomSeq,
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

/**
 * Dòng `audit_logs` → DTO nhật ký (CHAT-SCREEN-008).
 *
 * `metadata` là `jsonb` TỰ DO. Chỉ hai khoá được phơi: `endpoint` (nhãn loại truy cập) và `criteria`
 * (tiêu chí tra của `018a`). Trả nguyên `metadata` là hợp đồng mở — mọi khoá mà một WO sau ghi thêm vào
 * đó sẽ tự động rời server qua đúng màn hình này.
 */
export function toOversightAuditEntryDto(row: ChatOversightAuditRow): ChatOversightAuditEntryDto {
  const meta = asRecord(row.metadata);
  const endpoint = typeof meta["endpoint"] === "string" ? meta["endpoint"] : null;
  const criteria = isRecord(meta["criteria"])
    ? (meta["criteria"] as Record<string, unknown>)
    : null;

  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    roomId: row.roomId,
    roomCode: row.roomCode,
    roomName: row.roomName,
    // `resultStatus` ở DB là `varchar` nullable (writer cũ không set). Đường oversight LUÔN set, nên
    // NULL ở đây là dữ liệu hỏng — quy về `Denied` là an toàn hơn: một dòng đáng ngờ hiện lên như một
    // lần bị từ chối, thay vì như một lần đọc thành công hợp lệ.
    resultStatus: row.resultStatus === "Success" ? "Success" : "Denied",
    endpoint,
    criteria,
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

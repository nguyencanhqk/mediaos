import type {
  ChatOversightAttachmentDto,
  ChatOversightAuditEntryDto,
  ChatOversightMessageDto,
  ChatOversightRoomDetailDto,
  ChatOversightRoomSummaryDto,
  ChatRoomMemberDto,
} from "@mediaos/contracts";
import type { ChatMemberRole } from "../db/schema/communication";
// Danh sách DUY NHẤT — không chép bản thứ hai ở đây (nguồn gốc: CHECK mig 0432, ép ở tầng ghi bởi
// `AuditService`). Chép = thêm giá trị bên kia mà quên bên này ⇒ nhãn SAI, im lặng.
import { AUDIT_RESULT_STATUSES } from "../events/audit.service";
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
    resultStatus: toAuditResultStatus(row.resultStatus),
    endpoint,
    criteria,
    createdAt: toIso(row.createdAt) ?? EPOCH,
  };
}

type AuditResultStatus = (typeof AUDIT_RESULT_STATUSES)[number];

/**
 * `result_status` thô → nhãn nhật ký. Map TƯỜNG MINH cả bốn giá trị; lạ/NULL → nhãn RIÊNG `Unknown`.
 *
 * ⚠️ Bản đầu viết `row.resultStatus === 'Success' ? 'Success' : 'Denied'`. Nó giữ đúng bất biến quan
 * trọng nhất (dòng hỏng KHÔNG được hiện thành `Success`) nhưng đạt bằng cách **nói sai loại sự kiện**:
 * một dòng `Failure` (thu hồi tin hỏng — `chat.errors.ts`) hay `Error` (lỗi hạ tầng) hiện lên nhật ký
 * như "đã bị TỪ CHỐI", và đi thẳng vào thống kê từ chối của CHAT-SCREEN-008. Hôm nay CHAT-API-019 lọc
 * `action = OVERSIGHT_READ` nên chỉ hai writer đẻ ra dòng ⇒ chưa lộ; bẫy bung khi có writer thứ ba, lúc
 * đó không ai nhớ dòng ba-ngôi này (S7-CHAT-CLEAN-2).
 *
 * `Unknown` KHÔNG khẳng định gì cả — đó là điểm: dữ liệu hỏng phải LỘ RA, không được đội lốt một sự kiện
 * có thật. Bất biến "lạ/NULL không bao giờ ra `Success`" được khoá bằng ca test riêng.
 *
 * Nếu `AUDIT_RESULT_STATUSES` được thêm giá trị thứ năm, hàm này hỏng theo chiều AN TOÀN cho tới khi có
 * người đặt nhãn: giá trị mới đi qua nguyên vẹn (nó nằm trong danh sách), còn giá trị NGOÀI danh sách
 * vẫn ra `Unknown`.
 */
function toAuditResultStatus(raw: string | null): AuditResultStatus | "Unknown" {
  return (AUDIT_RESULT_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as AuditResultStatus)
    : "Unknown";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

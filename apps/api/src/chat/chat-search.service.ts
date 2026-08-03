import { Injectable } from "@nestjs/common";
import type {
  ChatSearchQuery,
  ChatSearchResponseDto,
  ChatSearchResultDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { decodeChatSearchCursor, encodeChatSearchCursor } from "./chat-search-cursor";
import { ChatSearchRepository, type ChatSearchRow } from "./chat-search.repository";
import type { ChatActor } from "./chat-rooms.service";

/**
 * S7-CHAT-BE-4 — CHAT-API-015 `GET /chat/search` (SPEC-15 §13.7).
 *
 * ┌─ HAI CHẾ ĐỘ, KHÔNG CHẾ ĐỘ NÀO BỎ QUA MEMBERSHIP ──────────────────────────────────────────────┐
 * │ có `roomId`  → `ChatAccessService.assertMember` (404 fail-closed, hằng `ROOM_NOT_FOUND`)       │
 * │ không roomId → JOIN membership NGAY TRONG truy vấn qua `messageReadConditions` (5 vế)          │
 * │                                                                                                │
 * │ Cả hai đi qua CÙNG một hàm repo; nhánh `roomId` chỉ THÊM một vế thu hẹp. Hai bộ dựng truy vấn  │
 * │ là hai thứ sẽ trôi.                                                                            │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG ghi audit** — tường minh, không phải bỏ quên. SPEC-15 §3.3/§18 chốt audit theo *phòng*, không
 * theo *câu truy vấn*: ghi ở đây là lưu lại **nội dung người dùng gõ** vào `audit_logs` (bảng append-only
 * dùng chung), và vẫn không trả lời được câu hỏi "ai đã đọc phòng nào". Đường đọc-vượt có audit là
 * `/chat/oversight/*` (`S7-CHAT-BE-7`), theo từng phòng.
 *
 * ⚠️ **KHÔNG ký URL tệp nào.** DTO chỉ mang `attachmentCount`. Tái dùng `chatMessageSchema` (đã mang
 * `attachments` kèm URL ký từ BE-3) biến ô tìm kiếm thành máy phát URL ký hàng loạt — 50 URL/trang, mỗi
 * lần gõ phím. Muốn tệp thì mở phòng (`/rooms/:id/files`, có access-log).
 */
@Injectable()
export class ChatSearchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatSearchRepository,
  ) {}

  async search(actor: ChatActor, query: ChatSearchQuery): Promise<ChatSearchResponseDto> {
    // Giải mã TRƯỚC khi mở tenant scope: con trỏ hỏng là lỗi đầu vào thuần, không đáng tốn một giao dịch.
    const cursor = query.cursor ? decodeChatSearchCursor(query.cursor) : undefined;

    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      // Chế độ MỘT phòng: khẳng định membership ở ĐIỂM DUY NHẤT của module để lấy đúng 404.
      //
      // ⚠️ KHÔNG bọc lại lỗi của `assertMember`. Nó đã ném `NotFoundException(ROOM_NOT_FOUND)` — hằng
      // dùng chung cho MỌI lý do (phòng không tồn tại · tenant khác · xoá mềm · mình không thuộc · đã
      // rời). Đổi thành 403 hay thêm `roomId` vào thông điệp là biến ô tìm kiếm thành oracle dò sự tồn
      // tại của phòng, đúng thứ CHAT-ERR-001 dựng 404 để chặn (SPEC-15 §12 · CHAT-ERR-017).
      if (query.roomId) {
        await this.access.assertMember(tx, actor.companyId, query.roomId, actor.id);
      }

      return this.repo.search(tx, actor.companyId, actor.id, {
        q: query.q,
        roomId: query.roomId,
        cursor,
        limit: query.limit,
      });
    });

    // Repo lấy `limit + 1`: hàng thừa tồn tại ⇔ còn trang sau. Đây là cách duy nhất biết điều đó mà không
    // đếm toàn bộ tập khớp — `COUNT(*)` trên đường này là quét lại y hệt truy vấn chính.
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      data: page.map(toSearchResultDto),
      nextCursor:
        hasMore && last ? encodeChatSearchCursor({ sortAt: last.sortAt, id: last.id }) : null,
    };
  }
}

function toSearchResultDto(row: ChatSearchRow): ChatSearchResultDto {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    roomType: row.roomType,
    roomSeq: row.roomSeq,
    senderId: row.senderId,
    senderName: row.senderName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    attachmentCount: row.attachmentCount,
  };
}

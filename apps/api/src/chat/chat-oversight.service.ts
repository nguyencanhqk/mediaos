import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type {
  ChatOversightAuditQuery,
  ChatOversightAuditResponseDto,
  ChatOversightMessageDto,
  ChatOversightMessagesQuery,
  ChatOversightRoomDetailDto,
  ChatOversightRoomListDto,
  ChatOversightRoomQuery,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import { assertCursorExclusive } from "./chat-message-rules";
import {
  toOversightAttachmentDto,
  toOversightAuditEntryDto,
  toOversightMessageDto,
  toOversightRoomDetailDto,
  toOversightRoomSummaryDto,
} from "./chat-oversight.mapper";
import { ChatOversightRepository } from "./chat-oversight.repository";
import {
  CHAT_OVERSIGHT_ENDPOINT,
  chatOversightAuditEntry,
  type ChatOversightEndpoint,
} from "./chat-oversight.audit";
import { CHAT_ERR } from "./chat.errors";
import type { ChatActor } from "./chat-rooms.service";
// ⚠️ Codec con trỏ DÙNG LẠI của `S7-CHAT-BE-4`, KHÔNG viết bản thứ hai. Luật "cắt về mili-giây ở CẢ khoá
// sắp xếp lẫn con trỏ" (jsdoc `chat-search-cursor.ts`) là thứ hiện thực sai một cách IM LẶNG — trang sau
// sót dòng, HTTP 200, không lỗi. Một bản ⇒ sửa một chỗ là sửa cả hai đường.
import { decodeChatSearchCursor, encodeChatSearchCursor } from "./chat-search-cursor";

/**
 * S7-CHAT-BE-7 🔒 — ĐƯỜNG ĐỌC-VƯỢT MEMBERSHIP (CHAT-DEC-004 · SPEC-15 §3.3 · API-13 §5.3).
 *
 * ┌─ HAI MÔ HÌNH TRANSACTION KHÁC NHAU — ĐỌC TRƯỚC KHI SỬA BẤT KỲ DÒNG NÀO ──────────────────────────┐
 * │ THÀNH CÔNG (file này): audit `Success` ghi trong **CÙNG** transaction với truy vấn đọc, **TRƯỚC** │
 * │   khi DTO rời hàm. Ghi audit lỗi ⇒ throw ⇒ rollback ⇒ **0 byte** dữ liệu ra ngoài + HTTP 500      │
 * │   (CHAT-ERR-020). Ghi audit SAU khi trả, hoặc ở interceptor ngoài transaction, là KHÔNG ĐẠT.      │
 * │ TỪ CHỐI (`ChatOversightAuditGuard`): audit `Denied` ghi ở transaction **RIÊNG ĐÃ COMMIT**, rồi    │
 * │   `PermissionGuard` mới ném 403. Ném 403 trong cùng tx sẽ **rollback mất** chính dòng đó.          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Service này **KHÔNG** gọi `ChatAccessService` — đó là chức năng của nó, không phải thiếu sót
 * (API-13 §5.3 ràng buộc 1). Đổi lại, MỌI hàm public ở đây phải ghi audit; hàm nào không ghi là một
 * đường đọc toàn tenant KHÔNG DẤU VẾT. Ca int-spec đếm `audit_logs` trước/sau từng route đóng đinh điều đó.
 *
 * ⚠️ **CHỈ ĐỌC.** Không có biến thể ghi dưới `/chat/oversight/` (ràng buộc 4) — SA không gửi/ghim/thu
 * hồi/sửa thành viên được ở phòng mình không thuộc.
 *
 * ⚠️ **KHÔNG emit WS** (ràng buộc 6): phiên đọc-vượt không join `co:{companyId}:chatroom:{roomId}` và
 * không nhận `chat:message`. Đọc-vượt là tra cứu có chủ đích TẠI MỘT THỜI ĐIỂM, không phải giám sát liên
 * tục — và mỗi lần tra để lại đúng một dòng audit.
 */
@Injectable()
export class ChatOversightService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatOversightRepository,
    private readonly attachmentRepo: ChatAttachmentsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * CHAT-API-018a — tra phòng theo mã/tên/loại. Trả **siêu dữ liệu**, KHÔNG nội dung tin, KHÔNG thành viên.
   *
   * `objectId` của dòng audit là **NULL** (không có phòng đích); tiêu chí tra đi vào `metadata.criteria`
   * — đó là thứ trả lời câu hỏi điều tra "người này đã tra cái gì" (API-13 §5.3).
   */
  async searchRooms(
    actor: ChatActor,
    query: ChatOversightRoomQuery,
  ): Promise<ChatOversightRoomListDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.searchRooms(tx, actor.companyId, {
        q: query.q,
        roomType: query.roomType,
        limit: query.limit,
      });
      // Repo trả `limit + 1` ⇒ dư một hàng nghĩa là còn kết quả bị cắt. Cắt trang mà im lặng đọc ra y hệt
      // "đã trả hết" (no-silent-caps) nên cờ này là một phần của hợp đồng, không phải tiện ích.
      const truncated = rows.length > query.limit;
      const page = truncated ? rows.slice(0, query.limit) : rows;

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_SEARCH, null, {
        q: query.q,
        roomType: query.roomType ?? null,
        resultCount: page.length,
        truncated,
      });

      return { data: page.map(toOversightRoomSummaryDto), truncated };
    });
  }

  /** CHAT-API-018b — chi tiết phòng + thành viên. Audit `object_id = roomId`, MỖI LẦN GỌI. */
  async getRoom(actor: ChatActor, roomId: string): Promise<ChatOversightRoomDetailDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const room = await this.repo.findRoom(tx, actor.companyId, roomId);
      // 404 với HẰNG dùng chung — GIỐNG HỆT đường đọc thường. Kèm chi tiết ở đây là biến chính đường
      // quản trị thành oracle dò sự tồn tại của phòng (CHAT-ERR-001).
      if (!room) throw new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND);

      const members = await this.repo.listActiveMembers(tx, actor.companyId, roomId);

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_DETAIL, roomId, {
        memberCount: members.length,
      });

      return toOversightRoomDetailDto(room, members);
    });
  }

  /**
   * CHAT-API-018c — một trang tin, **TOÀN DẢI `seq`** của phòng (ràng buộc 8), con trỏ RIÊNG.
   *
   * Đính kèm trả **metadata thuần, 0 URL ký** (ràng buộc 7): `ChatAttachmentPresignService` **không**
   * được gọi ở đây. Nó có mặt trong module cho đường đọc thường; kéo nó vào đây là biến payload oversight
   * thành máy phát khoá đọc tệp KHÔNG CẦN MEMBERSHIP — và khoá đó đi qua route FOUNDATION Files, nơi
   * KHÔNG có dòng audit CHAT nào.
   */
  async listMessages(
    actor: ChatActor,
    roomId: string,
    query: ChatOversightMessagesQuery,
  ): Promise<ChatOversightMessageDto[]> {
    // Loại trừ con trỏ ép TRƯỚC khi mở transaction: đây là lỗi đầu vào (CHAT-ERR-016, 422), không phải
    // một lần đọc-vượt — nó KHÔNG được sinh dòng audit `Success`.
    assertCursorExclusive(query.beforeSeq, query.afterSeq);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const room = await this.repo.findRoom(tx, actor.companyId, roomId);
      if (!room) throw new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND);

      const rows = await this.repo.listMessages(tx, actor.companyId, roomId, {
        beforeSeq: query.beforeSeq,
        afterSeq: query.afterSeq,
        limit: query.limit,
      });

      // Tin ĐÃ THU HỒI vẫn bị che ở mapper ⇒ không nạp đính kèm của chúng (mapper sẽ trả `[]` bất kể).
      const attachableIds = rows.filter((r) => r.recalledAt === null).map((r) => r.id);
      const attachments = await this.attachmentRepo.listAttachmentsForMessages(
        tx,
        actor.companyId,
        attachableIds,
      );
      const byMessage = new Map<string, ReturnType<typeof toOversightAttachmentDto>[]>();
      for (const a of attachments) {
        const bucket = byMessage.get(a.messageId);
        if (bucket) bucket.push(toOversightAttachmentDto(a));
        else byMessage.set(a.messageId, [toOversightAttachmentDto(a)]);
      }

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_MESSAGES, roomId, {
        beforeSeq: query.beforeSeq ?? null,
        afterSeq: query.afterSeq ?? null,
        resultCount: rows.length,
      });

      return rows.map((r) => toOversightMessageDto(r, byMessage.get(r.id) ?? []));
    });
  }

  /**
   * CHAT-API-019 — nhật ký đọc-vượt (CHAT-SCREEN-008).
   *
   * ⚠️ **KHÔNG ghi audit `Success`** — API-13 §5.3 bảng endpoint ghi cột Audit của 019 là `—`. Đọc nhật ký
   * KHÔNG phải đọc-vượt: nó không tiết lộ một byte nội dung chat nào. Ghi Success ở đây làm chính màn
   * CHAT-SCREEN-008 tự sinh nhiễu mỗi lần mở, và lối sửa rẻ nhất khi đó là lọc bỏ chúng khỏi truy vấn —
   * tức bịt mắt sổ. (Đường TỪ CHỐI thì vẫn ghi `Denied`: guard áp đồng nhất cho cả 4 route, xem
   * `ChatOversightAuditGuard`.)
   */
  async listAudit(
    actor: ChatActor,
    query: ChatOversightAuditQuery,
  ): Promise<ChatOversightAuditResponseDto> {
    // Con trỏ hỏng → 400 NGAY, trước khi mở transaction. KHÔNG im lặng rơi về trang đầu: rơi về trang
    // đầu biến một con trỏ hỏng thành vòng lặp vô hạn ở FE (trang 2 luôn trả trang 1).
    const cursor = query.cursor === undefined ? undefined : decodeChatSearchCursor(query.cursor);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.listOversightAudit(tx, actor.companyId, {
        limit: query.limit,
        cursor,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map(toOversightAuditEntryDto),
        nextCursor:
          hasMore && last ? encodeChatSearchCursor({ sortAt: last.sortAt, id: last.id }) : null,
      };
    });
  }

  /**
   * Ghi dòng `Success` TRONG tx đang mở. Lỗi ⇒ **500 CHAT-ERR-020** ⇒ `withTenant` rollback ⇒ 0 byte.
   *
   * ⚠️ `try/catch` bọc HẸP đúng lời gọi audit, KHÔNG bao câu đọc phía trên: bao rộng thì một lỗi đọc
   * (phòng biến mất giữa chừng, DB rớt) cũng bị báo là "lỗi ghi nhật ký" — sai nguyên nhân trên đúng
   * đường mà chẩn đoán đúng là quan trọng nhất.
   *
   * ⚠️ Ném `InternalServerErrorException` chứ KHÔNG nuốt-rồi-trả-rỗng: `200` với thân rỗng LÀ
   * "đọc-vượt không dấu vết" ngụy trang thành kết quả trống (API-13 §8).
   */
  private async recordSuccess(
    tx: TenantTx,
    actor: ChatActor,
    endpoint: ChatOversightEndpoint,
    roomId: string | null,
    criteria: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record(
        tx,
        chatOversightAuditEntry({
          actorUserId: actor.id,
          endpoint,
          roomId,
          resultStatus: "Success",
          criteria,
        }),
      );
    } catch (err: unknown) {
      throw new InternalServerErrorException(CHAT_ERR.OVERSIGHT_AUDIT_FAILED, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}

import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatRoomFileDto,
  ListChatRoomFilesQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileAccessLogService } from "../foundation/files/file-access-log.service";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { FilePolicyAction } from "../foundation/files/file-policy.types";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter.port";
import { ChatAccessService } from "./chat-access.service";
import {
  ChatAttachmentsRepository,
  type ChatAttachmentRow,
  type ChatFileLinkRef,
  type ChatRoomFileRow,
} from "./chat-attachments.repository";
import type { ChatMessageRow } from "./chat-messages.repository";
import {
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MESSAGE_ENTITY_TYPE,
  isAttachableFile,
  isImageMimeType,
  trimToMessageBoundary,
} from "./chat-file.constants";
import { CHAT_MODULE_CODE } from "./chat.errors";
import { toChatMessageDto } from "./chat.mapper";
import type { ChatActor } from "./chat-rooms.service";

/** `permission_code` ghi vào `file_access_logs` khi ký URL cho tab Tệp (quy ước SPEC-01 §9). */
const CHAT_FILE_PERMISSION_CODE = "CHAT.CHAT-ROOM.VIEW";

/**
 * S7-CHAT-BE-3 — ĐIỂM KÝ URL DUY NHẤT của module CHAT (SPEC-15 §13.5 bước 4).
 *
 * ┌─ BẤT BIẾN CỦA FILE NÀY ─────────────────────────────────────────────────────────────────────┐
 * │ MỌI URL tệp mà CHAT phát ra đều đi qua `FilePolicyService.decideForLinkedFile(…, Download)`. │
 * │ KHÔNG có nhánh nào "đã `assertMember` rồi nên ký thẳng cho nhanh".                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * VÌ SAO: done_when của WO đòi chứng minh được "gỡ đăng ký `ChatMessageFileResolver` ⇒ **mọi** đường tải
 * 403". Tính chất đó chỉ đúng khi không đường ký nào tự quyết định. Ký thẳng sau `assertMember` sẽ làm
 * đúng ca test số 1 XANH GIẢ: đường FOUNDATION 403, còn đường CHAT vẫn phát URL bình thường — và không ai
 * biết cho tới khi một module khác đăng ký resolver chồng lên.
 *
 * HỆ QUẢ CÓ CHỦ Ý của luật AND (most-restrictive) trong `decideForLinkedFile`: tệp vừa là đính kèm CHAT
 * vừa mang link của module khác (ví dụ hợp đồng HR) sẽ bị resolver kia từ chối ⇒ **không ký** ⇒
 * `url: null`. Đó là fail-closed đúng chiều, không phải lỗi cần "sửa cho chạy".
 *
 * FAIL-SOFT CÓ LOG (mẫu `AvatarPresignService`): deny / trạng thái tệp xấu / storage lỗi ⇒ `url: null`,
 * **KHÔNG ném**. Một tệp hỏng không được làm trắng cả trang tin. Metadata (tên · kích thước · MIME) vẫn
 * trả — nó không nhạy cảm và FE cần nó để hiện "tệp không tải được" thay vì một ô trống không giải thích.
 *
 * ⚠️ `storagePath` KHÔNG BAO GIỜ rời file này (CLAUDE.md §2.3): nó vào `storage.get()` và dừng ở đó.
 */
@Injectable()
export class ChatAttachmentPresignService {
  private readonly logger = new Logger(ChatAttachmentPresignService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatAttachmentsRepository,
    private readonly policy: FilePolicyService,
    private readonly accessLog: FileAccessLogService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Row tin → DTO, gắn kèm tệp đã ký. Đây là đường DUY NHẤT dựng `ChatMessageDto` từ WO này trở đi.
   *
   * ⚠️ **PHẢI gọi NGOÀI transaction của caller.** Ký tệp đi qua `FilePolicyService`, mà resolver và
   * truy vấn link đều tự mở `withTenant` riêng — lồng `withTenant` trong `withTenant` là chiếm client thứ
   * hai từ pool khi client thứ nhất còn đang giữ transaction, và trên PgBouncer transaction-mode nó TREO
   * chứ không báo lỗi (đúng lý do `AvatarPresignService` nhận `callerTx` thay vì tự mở). Vì vậy mọi
   * caller đọc row TRONG tx rồi mới gọi hàm này SAU khi tx đã commit.
   *
   * Caller đã `assertMember`/`assertMessageAccess` và đã lọc row qua vị từ §13.4 trước đó. Hàm này KHÔNG
   * khẳng định membership — nó khẳng định QUYỀN TỆP qua policy layer, câu hỏi khác, không thay thế nhau.
   *
   * KHÔNG ghi `file_access_logs`: hàm chạy mỗi lần cuộn trang tin. Ghi ở đây là nhấn chìm một bảng
   * append-only DÙNG CHUNG (đang phục vụ điều tra FOUNDATION/HR) bằng lưu lượng cuộn chat — cùng lý do
   * `S7-CHAT-BE-2` không ghi audit cho gửi/đọc tin. Đường KÉO CẢ KHO tệp (`listRoomFiles`) thì CÓ ghi.
   */
  async decorate(actor: ChatActor, rows: readonly ChatMessageRow[]): Promise<ChatMessageDto[]> {
    if (rows.length === 0) return [];

    // Tin đã thu hồi KHÔNG hỏi tệp: DTO của chúng luôn `attachments: []` (mapper). Bỏ ra khỏi lô để không
    // tốn truy vấn cho một kết quả đã biết.
    //
    // ⚠️ KHÔNG lọc thêm `attachmentCount > 0` — FULL gate bắt: `attachment_count` chỉ được đặt lúc INSERT
    // (cột không có GRANT UPDATE), trong khi `canAttach` cho phép chủ tin gắn thêm tệp qua đường FOUNDATION.
    // Lọc theo con số cũ làm mọi tệp gắn sau **vô hình vĩnh viễn** trên `/messages` dù tab Tệp vẫn liệt kê
    // và vẫn ký URL — hai đường đọc nói hai chuyện khác nhau, không có đường sửa qua API. Chi phí của việc
    // bỏ vế này là đúng MỘT truy vấn lô vốn đã chạy.
    const ids = rows.filter((r) => r.recalledAt === null).map((r) => r.id);
    const byMessage = await this.attachmentsByMessage(actor, ids);
    return rows.map((row) => toChatMessageDto(row, byMessage.get(row.id) ?? []));
  }

  /** Một tin — `decorate` cho trường hợp một row (đường ghi trả lại tin vừa tạo/sửa). */
  async decorateOne(actor: ChatActor, row: ChatMessageRow): Promise<ChatMessageDto> {
    const [dto] = await this.decorate(actor, [row]);
    return dto;
  }

  /** `messageId → tệp đã ký`. Mở tx RIÊNG để đọc link, rồi ký NGOÀI tx (xem cảnh báo ở `decorate`). */
  private async attachmentsByMessage(
    actor: ChatActor,
    messageIds: readonly string[],
  ): Promise<Map<string, ChatAttachmentDto[]>> {
    const out = new Map<string, ChatAttachmentDto[]>();
    if (messageIds.length === 0) return out;

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listAttachmentsForMessages(tx, actor.companyId, messageIds),
    );
    if (rows.length === 0) return out;

    const urls = await this.signMany(actor, rows);
    for (const row of rows) {
      const list = out.get(row.messageId) ?? [];
      list.push(this.toDto(row, urls.get(row.fileId) ?? null));
      out.set(row.messageId, list);
    }
    return out;
  }

  /**
   * CHAT-API-017 — `GET /chat/rooms/:id/files`.
   *
   * `assertMember` TRƯỚC mọi thứ khác (404 chung, không phân biệt "phòng lạ" với "không phải thành viên"),
   * rồi mới đọc — và `visibleFromSeq` lấy từ chính kết quả đó, không tự bịa.
   */
  async listRoomFiles(
    actor: ChatActor,
    roomId: string,
    query: ListChatRoomFilesQuery,
  ): Promise<ChatRoomFileDto[]> {
    const fetched = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      return this.repo.listRoomFiles(tx, actor.companyId, roomId, {
        beforeSeq: query.beforeSeq,
        // Lấy DƯ `trần-tệp-mỗi-tin + 1` hàng — điều kiện tiên quyết của `trimToMessageBoundary`:
        // con trỏ trang kế là `room_seq` nhỏ nhất của trang này và vị từ LOẠI TRỪ, nên một tin bị chẻ
        // đôi giữa hai trang sẽ MẤT phần đuôi vĩnh viễn. Dư đủ để trả TRỌN một nhóm ở ca biên
        // (`limit` nhỏ hơn số tệp của một tin). Tối đa 50 + 10 + 1 = 61 hàng.
        limit: query.limit + CHAT_MAX_ATTACHMENTS_PER_MESSAGE + 1,
        visibleFromSeq: acc.membership.visibleFromSeq,
      });
    });
    const rows = trimToMessageBoundary(fetched, query.limit);
    if (rows.length === 0) return [];

    const urls = await this.signMany(actor, rows);
    await this.logSignedUrls(actor, rows, urls);
    return rows.map((row) => this.toRoomFileDto(row, urls.get(row.fileId) ?? null));
  }

  // ─── ký ───────────────────────────────────────────────────────────────────────

  /**
   * `fileId → url` cho những tệp ĐƯỢC PHÉP tải. Khử trùng theo `fileId`: cùng một tệp xuất hiện ở nhiều
   * tin (gửi lại ở phòng khác) chỉ tốn MỘT quyết định + MỘT chữ ký.
   *
   * Quyết định chạy TUẦN TỰ chứ không `Promise.all`: mỗi lần dispatch resolver là một `withTenant` riêng,
   * bắn song song N cái sẽ rút cạn pool PgBouncer transaction-mode cho đúng một trang tin.
   *
   * Link của CẢ LÔ nạp bằng MỘT truy vấn (`listLinksForFiles`) chứ không mỗi tệp một `withTenant`: trên
   * `/messages` lô có thể tới `limit` tin × trần tệp/tin, và bản đầu tốn 1 giao dịch chỉ để đọc link của
   * mỗi tệp. Phần còn lại (một dispatch policy/tệp) là chi phí ĐÃ BIẾT — xem §6.4 của micro-plan.
   */
  private async signMany(
    actor: ChatActor,
    rows: readonly ChatAttachmentRow[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const fileIds = [...new Set(rows.map((r) => r.fileId))];
    if (fileIds.length === 0) return out;

    // Luật AND của `decideForLinkedFile` chỉ đúng khi thấy ĐỦ link của tệp — kể cả link của module khác.
    // Vì vậy truy vấn này KHÔNG lọc `module_code`.
    const linksByFile = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listLinksForFiles(tx, actor.companyId, fileIds),
    );

    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.fileId)) continue;
      seen.add(row.fileId);
      const url = await this.signOne(actor, row, linksByFile.get(row.fileId) ?? []);
      if (url) out.set(row.fileId, url);
    }
    return out;
  }

  /** `null` = không ký được (mọi lý do). KHÔNG ném — xem jsdoc lớp (fail-soft có log). */
  private async signOne(
    actor: ChatActor,
    row: ChatAttachmentRow,
    links: readonly ChatFileLinkRef[],
  ): Promise<string | null> {
    // Trạng thái tệp: cùng luật với FOUNDATION (`fileDownloadStateDenyReason` qua `isAttachableFile`).
    // Đặt TRƯỚC quyết định quyền vì nó rẻ hơn và không cần truy vấn nào.
    if (!isAttachableFile(row)) return null;

    try {
      // 0 link = tệp đã rời mọi entity ⇒ KHÔNG ký. Giữ đai này dù `S7-FND-LINKFALLBACK-1` đã vá lỗ ở
      // tầng policy: đây là đường ký của CHAT, chặn sớm thì rẻ hơn và không phụ thuộc cờ do caller truyền.
      if (links.length === 0) return null;
      const decision = await this.policy.decideForLinkedFile(
        {
          companyId: actor.companyId,
          userId: actor.id,
          fileId: row.fileId,
          moduleCode: CHAT_MODULE_CODE,
          entityType: CHAT_MESSAGE_ENTITY_TYPE,
          entityId: row.messageId,
          action: FilePolicyAction.Download,
        },
        links,
        FilePolicyAction.Download,
        // `everLinked` chỉ được policy dùng khi `links` RỖNG — mà đường này đã chặn 0-link ở trên nên
        // không bao giờ tới đó. Truyền `true` để nếu ai gỡ đai kia thì hành vi rơi về FAIL-CLOSED
        // (deny-links-revoked) chứ không phải mở fallback FOUNDATION.FILE.*.
        true,
      );
      if (!decision.allow) {
        // Không log ồn cho đường từ chối THƯỜNG GẶP (`deny-resolver` = không phải thành viên nữa).
        // `deny-no-resolver` thì ngược lại: đó là dấu hiệu resolver rơi khỏi đăng ký ⇒ tính năng chết
        // trong im lặng, phải kêu.
        // S7-CHAT-BE-GATE-3 (L4 HIGH) — từ chối do LINK KHÁC, không phải do tin đang đọc.
        // Ca thật: chủ tệp gửi LẠI cùng tệp sang phòng thứ hai ⇒ tệp có 2 link `chat_message`; luật AND
        // khiến người ở phòng A (không thuộc phòng B) mất `url` NGAY TẠI PHÒNG A. Trước đây câm hoàn
        // toàn: người dùng thấy tên + kích thước, bấm tải không được, 0 lỗi, 0 log, không cách nào chẩn.
        // KHÔNG hạ luật AND để "sửa" — xem ghi chú ở đầu lớp: nới nó là mở đường leo thang.
        const blocker = decision.deniedByLink;
        if (blocker && blocker.entityId !== row.messageId) {
          this.logger.warn(
            `chat attachment presign denied bởi LINK KHÁC: file=${row.fileId} ` +
              `tin đang đọc=${row.messageId} nhưng bị chặn tại ` +
              `${blocker.moduleCode}/${blocker.entityType}/${blocker.entityId} — ` +
              `tệp đang được dùng ở nhiều nơi, người này không đủ quyền ở TẤT CẢ.`,
          );
        }
        if (decision.reason === "deny-no-resolver" || decision.reason === "deny-error") {
          this.logger.error(
            `chat attachment presign denied: reason=${decision.reason} file=${row.fileId} ` +
              `message=${row.messageId} — resolver CHAT/chat_message còn đăng ký không?`,
          );
        }
        return null;
      }
      const signed = await this.storage.get({ key: row.storagePath, companyId: actor.companyId });
      return signed.url;
    } catch (err) {
      // Degrade CÓ LOG (không nuốt im lặng): storage lỗi/cấu hình thiếu ⇒ tệp hiện "không tải được",
      // trang tin vẫn trả. Kèm lý do để một BUG THẬT không lẩn sau fail-soft.
      this.logger.warn(
        `chat attachment presign failed: file=${row.fileId} message=${row.messageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
  }

  /**
   * Một dòng `file_access_logs` `'GenerateSignedUrl'` cho mỗi tệp ĐÃ ký ở tab Tệp.
   *
   * Không có nó thì việc kéo toàn bộ kho tệp của một phòng **không để lại dấu vết nào** — trong khi từng
   * lượt tải qua FOUNDATION thì có.
   *
   * ⚠️ **FAIL-CLOSED, KHÔNG best-effort.** Bản đầu nuốt lỗi ghi thành `logger.warn` rồi vẫn trả URL — tức
   * là giữ nguyên đúng trạng thái "kéo cả kho không để lại dấu vết", chỉ thêm một dòng warn mà không ai
   * đọc. Lỗi ghi log giờ NÉM: URL đã ký nhưng chưa rời tiến trình, nên không có gì bị rò. Cùng khuôn với
   * CHAT-ERR-020 (audit hỏng ⇒ 0 byte dữ liệu ra ngoài).
   */
  private async logSignedUrls(
    actor: ChatActor,
    rows: readonly ChatRoomFileRow[],
    urls: ReadonlyMap<string, string>,
  ): Promise<void> {
    const signed = rows.filter((r) => urls.has(r.fileId));
    if (signed.length === 0) return;
    await this.db.withTenant(actor.companyId, async (tx) => {
      for (const row of signed) {
        await this.accessLog.record(tx, {
          fileId: row.fileId,
          action: "GenerateSignedUrl",
          accessGranted: true,
          actorUserId: actor.id,
          fileLinkId: row.linkId,
          moduleCode: CHAT_MODULE_CODE,
          entityType: CHAT_MESSAGE_ENTITY_TYPE,
          entityId: row.messageId,
          permissionCode: CHAT_FILE_PERMISSION_CODE,
        });
      }
    });
  }

  // ─── map sang DTO ─────────────────────────────────────────────────────────────

  private toDto(row: ChatAttachmentRow, url: string | null): ChatAttachmentDto {
    const isImage = isImageMimeType(row.mimeType);
    return {
      id: row.linkId,
      fileId: row.fileId,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      isImage,
      url,
      // v1: xem-trước dùng CHÍNH bản gốc — repo chưa có pipeline sinh biến thể resize (micro-plan §1.6).
      // Tệp không phải ảnh → `null` ⇒ FE hiện tên + kích thước (SPEC-15 §13.5 câu cuối).
      thumbnailUrl: isImage ? url : null,
    };
  }

  private toRoomFileDto(row: ChatRoomFileRow, url: string | null): ChatRoomFileDto {
    return {
      ...this.toDto(row, url),
      messageId: row.messageId,
      roomSeq: row.roomSeq,
      senderId: row.senderId,
      senderName: row.senderName,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

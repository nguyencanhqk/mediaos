import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatMessages } from "../db/schema/communication";
import { fileLinks, files, type NewFileLink } from "../db/schema/files";
import { users } from "../db/schema/users";
import {
  CHAT_ATTACHMENT_ACCESS_SCOPE,
  CHAT_ATTACHMENT_LINK_TYPE,
  CHAT_MESSAGE_ENTITY_TYPE,
} from "./chat-file.constants";
import { CHAT_MODULE_CODE } from "./chat.errors";
import { visibleFromSeqScalar } from "./chat-visibility";

/**
 * Một link sống của tệp, rút gọn về đúng ba trường `FilePolicyService.decideForLinkedFile` cần để dispatch.
 * Giữ cùng hình dạng với `FileLinkRef` của FOUNDATION để truyền thẳng, không map lại.
 */
export interface ChatFileLinkRef {
  moduleCode: string;
  entityType: string;
  entityId: string;
}

/** Tệp ứng viên lúc GỬI — chỉ đủ cột để quyết định "có gắn được không". */
export interface ChatCandidateFileRow {
  id: string;
  mimeType: string;
  scanStatus: string;
  uploadStatus: string;
}

/**
 * Một đính kèm sống của một tin.
 *
 * ⚠️ `storagePath` là cột **KHÔNG BAO GIỜ ra khỏi server** (CLAUDE.md §2.3). Nó có mặt ở đây vì
 * `ChatAttachmentPresignService` cần nó để ký — và CHỈ nó. Không mapper nào được đọc trường này; DTO
 * `chatAttachmentSchema` không có khoá tương ứng, nên `.parse()` sẽ strip kể cả khi ai đó lỡ trải `...row`.
 */
export interface ChatAttachmentRow {
  /** id hàng `file_links` (khoá ổn định cho FE), KHÔNG phải id tệp. */
  linkId: string;
  fileId: string;
  messageId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  scanStatus: string;
  uploadStatus: string;
}

/** Một dòng tab "Tệp": đính kèm + ngữ cảnh tin chứa nó. */
export interface ChatRoomFileRow extends ChatAttachmentRow {
  roomSeq: number;
  senderId: string;
  senderName: string | null;
  createdAt: Date;
}

/**
 * S7-CHAT-BE-3 — data-access của ĐÍNH KÈM (SPEC-15 §13.5 · DB-12 §6.5). Mọi hàm nhận `tx` — service giữ
 * ranh giới transaction (link phải nằm CÙNG tx với INSERT tin).
 *
 * ⚠️ QUYỀN GHI Ở DB — đọc trước khi thêm câu nào:
 *   • `file_links`: `GRANT SELECT, INSERT, UPDATE` — **KHÔNG DELETE** (`0433:182`) ⇒ gỡ link = soft delete.
 *   • `files`: repo này CHỈ ĐỌC. Vòng đời tệp thuộc FOUNDATION.
 *   • `chat_messages`: CHỈ ĐỌC ở đây; `attachment_count` đặt trong câu INSERT của
 *     `ChatMessagesRepository.insertMessage` vì cột đó **không có GRANT UPDATE** (`0538:350`).
 * TypeScript mù với cả ba; chỉ int-spec trên DB thật bắt được (42501).
 */
@Injectable()
export class ChatAttachmentsRepository {
  /**
   * Tệp mà `ownerUserId` ĐÃ TẢI LÊN, trong tenant, chưa xoá mềm.
   *
   * CỐ Ý **không** lọc `upload_status`/`scan_status` trong SQL: luật "tệp có ở trạng thái dùng được
   * không" sống ở MỘT chỗ — `fileDownloadStateDenyReason` (FOUNDATION) qua `isAttachableFile`. Lọc thêm ở
   * đây là dựng bản sao thứ hai, và bản sao sẽ trôi khi FOUNDATION thêm trạng thái mới.
   *
   * Vế `owner_user_id` là chốt chặn TẠI NGUỒN của SPEC-15 §13.5 (không mượn kênh chat phát tán tệp người
   * khác) — nó nằm trong SQL chứ không ở JS để không có nhánh nào bỏ qua được.
   */
  async findOwnedFiles(
    tx: TenantTx,
    companyId: string,
    ownerUserId: string,
    fileIds: readonly string[],
  ): Promise<ChatCandidateFileRow[]> {
    if (fileIds.length === 0) return [];
    return tx
      .select({
        id: files.id,
        mimeType: files.mimeType,
        scanStatus: files.scanStatus,
        uploadStatus: files.uploadStatus,
      })
      .from(files)
      .where(
        and(
          eq(files.companyId, companyId),
          // `inArray` của drizzle — KHÔNG nội suy `${array}` vào `sql` tay: cách đó sinh câu lệnh sai và
          // nổ 500 lúc chạy trong khi typecheck lẫn unit test đều mù (memory `drizzle-array-bind-sql-param`).
          inArray(files.id, [...fileIds]),
          eq(files.ownerUserId, ownerUserId),
          isNull(files.deletedAt),
        ),
      );
  }

  /**
   * Tạo link đính kèm cho MỘT tin — gọi TRONG tx gửi tin.
   *
   * `is_primary` để `false` cho mọi đính kèm: `uq_file_links_primary_per_entity_type` chỉ cho ĐÚNG MỘT
   * primary trên mỗi `(entity, link_type)`, nên đặt `true` sẽ làm tin thứ hai có tệp nổ `23505`.
   */
  async insertAttachmentLinks(
    tx: TenantTx,
    input: {
      companyId: string;
      messageId: string;
      createdBy: string;
      fileIds: readonly string[];
    },
  ): Promise<Array<{ id: string; fileId: string }>> {
    if (input.fileIds.length === 0) return [];
    const values: NewFileLink[] = input.fileIds.map((fileId) => ({
      companyId: input.companyId,
      fileId,
      moduleCode: CHAT_MODULE_CODE,
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: input.messageId,
      linkType: CHAT_ATTACHMENT_LINK_TYPE,
      accessScope: CHAT_ATTACHMENT_ACCESS_SCOPE,
      isPrimary: false,
      createdBy: input.createdBy,
    }));
    return tx
      .insert(fileLinks)
      .values(values)
      .returning({ id: fileLinks.id, fileId: fileLinks.fileId });
  }

  /**
   * MỌI link sống của một LÔ tệp, gom theo `fileId` — MỘT truy vấn cho cả trang.
   *
   * ⚠️ CỐ Ý **không** lọc `module_code`: `FilePolicyService.decideForLinkedFile` áp luật AND
   * (most-restrictive) trên TOÀN BỘ link của tệp. Chỉ đưa link CHAT vào là tự bỏ qua verdict của module
   * khác — ví dụ một tệp vừa là đính kèm chat vừa là hợp đồng HR sẽ được ký cho người không có quyền HR.
   *
   * Thay cho `FileLinkRepository.listByFileTx` gọi mỗi tệp một lần: trên `/messages` lô có thể tới
   * `limit` tin × trần tệp/tin, mỗi lần là một `withTenant` riêng (FULL gate MEDIUM-1).
   */
  async listLinksForFiles(
    tx: TenantTx,
    companyId: string,
    fileIds: readonly string[],
  ): Promise<Map<string, ChatFileLinkRef[]>> {
    const out = new Map<string, ChatFileLinkRef[]>();
    if (fileIds.length === 0) return out;

    const rows = await tx
      .select({
        fileId: fileLinks.fileId,
        moduleCode: fileLinks.moduleCode,
        entityType: fileLinks.entityType,
        entityId: fileLinks.entityId,
      })
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          inArray(fileLinks.fileId, [...fileIds]),
          isNull(fileLinks.deletedAt),
        ),
      );

    for (const row of rows) {
      const bucket = out.get(row.fileId);
      const ref = {
        moduleCode: row.moduleCode,
        entityType: row.entityType,
        entityId: row.entityId,
      };
      if (bucket) bucket.push(ref);
      else out.set(row.fileId, [ref]);
    }
    return out;
  }

  /**
   * Số link đính kèm SỐNG của MỘT tin — ép trần `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` ở đường ghi thứ hai
   * (`POST /foundation/files/:id/links`), nơi Zod của `sendMessageSchema` không với tới.
   *
   * Trần này là điều kiện tiên quyết của `trimToMessageBoundary`: vượt trần thì tab Tệp mất tệp trong im
   * lặng chứ không báo lỗi — xem jsdoc `ChatMessageFileResolver.canAttach`.
   */
  async countActiveLinks(tx: TenantTx, companyId: string, messageId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, CHAT_MODULE_CODE),
          eq(fileLinks.entityType, CHAT_MESSAGE_ENTITY_TYPE),
          eq(fileLinks.entityId, messageId),
          isNull(fileLinks.deletedAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * Đính kèm SỐNG của một LÔ tin — một truy vấn cho cả trang tin.
   *
   * Nạp theo lô chứ không theo từng tin: `/messages` là đường đọc nóng nhất module (mỗi lần cuộn), N+1 ở
   * đây là N+1 trên chính đường đó.
   *
   * CỐ Ý KHÔNG mang vị từ §13.4: hàm nhận `messageIds` mà caller ĐÃ lọc qua vị từ đó (`listMessages` /
   * `listPinned` / `findMessageForDto` đều mang nó). Thêm lần nữa ở đây cần join lại `chat_room_members`
   * — tức là bản sao thứ hai của luật membership, đúng thứ `ChatAccessService` sinh ra để không có.
   */
  async listAttachmentsForMessages(
    tx: TenantTx,
    companyId: string,
    messageIds: readonly string[],
  ): Promise<ChatAttachmentRow[]> {
    if (messageIds.length === 0) return [];
    return (
      tx
        .select({
          linkId: fileLinks.id,
          fileId: files.id,
          messageId: fileLinks.entityId,
          name: files.originalName,
          mimeType: files.mimeType,
          sizeBytes: files.fileSizeBytes,
          storagePath: files.storagePath,
          scanStatus: files.scanStatus,
          uploadStatus: files.uploadStatus,
        })
        .from(fileLinks)
        .innerJoin(
          files,
          and(eq(files.id, fileLinks.fileId), eq(files.companyId, fileLinks.companyId)),
        )
        .where(
          and(
            eq(fileLinks.companyId, companyId),
            eq(fileLinks.moduleCode, CHAT_MODULE_CODE),
            eq(fileLinks.entityType, CHAT_MESSAGE_ENTITY_TYPE),
            inArray(fileLinks.entityId, [...messageIds]),
            // Link đã gỡ (thu hồi tin) biến mất khỏi mọi đường đọc — SPEC-15 §13.6.
            isNull(fileLinks.deletedAt),
            isNull(files.deletedAt),
          ),
        )
        // ⚠️ `fileLinks.id` là vế THỨ HAI bắt buộc, không phải trang trí: `created_at` mặc định `now()` =
        // mốc BẮT ĐẦU transaction, nên mọi link của cùng một tin (INSERT nhiều hàng trong một tx) có
        // `created_at` GIỐNG HỆT nhau. ORDER BY trên khoá trùng để planner tự chọn thứ tự ⇒ ảnh trong một
        // tin đảo chỗ giữa hai lần cuộn. Đây là thứ tự ỔN ĐỊNH, KHÔNG phải thứ tự người dùng chọn — muốn
        // đúng thứ tự chọn thì cần cột `sort_order`, việc của WO khác.
        .orderBy(fileLinks.createdAt, fileLinks.id)
    );
  }

  /**
   * CHAT-API-017 — tệp đã gửi trong phòng, phân trang bằng CON TRỎ `room_seq` (cấm offset).
   *
   * Mang vị từ SPEC-15 §13.4 (`visibleFromSeqScalar`): tab "Tệp" đọc `chat_messages` như mọi đường đọc
   * khác. Thiếu nó thì đây là cửa hậu lấy đúng phần lịch sử mà `/messages` và `/pinned` đã chặn — cùng
   * một bảng, cùng nội dung, chỉ khác đường vào (đúng lỗ GATE-2 đã bắt trên `/pinned`).
   *
   * Tin ĐÃ THU HỒI bị loại bằng `recalled_at IS NULL`: link của chúng đã soft-delete nên vốn đã không
   * lọt, đây là đai thứ hai — soft-delete và cột thu hồi do hai câu lệnh khác nhau ghi.
   */
  async listRoomFiles(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    opts: { beforeSeq?: number; limit: number; visibleFromSeq: number | null },
  ): Promise<ChatRoomFileRow[]> {
    const conds: SQL[] = [
      eq(chatMessages.companyId, companyId),
      eq(chatMessages.roomId, roomId),
      isNull(chatMessages.recalledAt),
      eq(fileLinks.moduleCode, CHAT_MODULE_CODE),
      eq(fileLinks.entityType, CHAT_MESSAGE_ENTITY_TYPE),
      isNull(fileLinks.deletedAt),
      isNull(files.deletedAt),
    ];
    const visible = visibleFromSeqScalar(opts.visibleFromSeq);
    if (visible) conds.push(visible);
    if (opts.beforeSeq !== undefined) conds.push(lt(chatMessages.roomSeq, opts.beforeSeq));

    return tx
      .select({
        linkId: fileLinks.id,
        fileId: files.id,
        messageId: chatMessages.id,
        name: files.originalName,
        mimeType: files.mimeType,
        sizeBytes: files.fileSizeBytes,
        storagePath: files.storagePath,
        scanStatus: files.scanStatus,
        uploadStatus: files.uploadStatus,
        roomSeq: chatMessages.roomSeq,
        senderId: chatMessages.senderId,
        senderName: users.fullName,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .innerJoin(
        fileLinks,
        and(
          eq(fileLinks.entityId, chatMessages.id),
          eq(fileLinks.companyId, chatMessages.companyId),
        ),
      )
      .innerJoin(
        files,
        and(eq(files.id, fileLinks.fileId), eq(files.companyId, fileLinks.companyId)),
      )
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(and(...conds))
      .orderBy(desc(chatMessages.roomSeq), desc(fileLinks.createdAt))
      .limit(opts.limit);
  }
}

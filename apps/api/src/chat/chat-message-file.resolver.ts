import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { ChatAccessService } from "./chat-access.service";
import type { ChatMessageAccess } from "./chat-access.service";
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import {
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MESSAGE_ENTITY_TYPE,
  isAttachableFile,
} from "./chat-file.constants";
import { CHAT_MODULE_CODE } from "./chat.errors";

/**
 * Cặp quyền của đường ĐỌC tệp — **TRÙNG NGUYÊN VĂN** cặp của đường đọc TIN
 * (`ChatMessagesController.listMessages`). API-13 §6 nguyên tắc 3: `data_scope` là per-(permission,
 * role), nên tách một cặp riêng cho tệp sẽ đẻ ra role "tải được mà đọc không được" — hoặc ngược lại
 * (memory `read-path-gate-pair-must-match-download-pair`). Sửa cặp ở đây mà không sửa controller là mở
 * lại đúng lỗ đó, nên hai chỗ phải được đọc cùng nhau.
 */
const CHAT_READ_PAIR = { action: "view", resourceType: "chat-room" } as const;

/** Cặp quyền của đường GHI tệp — trùng cặp của `POST /chat/rooms/:id/messages`. */
const CHAT_SEND_PAIR = { action: "send", resourceType: "chat-message" } as const;

/**
 * S7-CHAT-BE-3 — `ChatMessageFileResolver` (SPEC-15 §13.5 · DB-12 §6.5 · API-13 §6 nguyên tắc 10).
 *
 * ┌─ VÌ SAO BẮT BUỘC ────────────────────────────────────────────────────────────────────────────┐
 * │ `FilePolicyService.decideForLinkedFile` FAIL-CLOSED: link nào có cặp (moduleCode, entityType)  │
 * │ chưa đăng ký resolver thì trả thẳng `deny-no-resolver` và **KHÔNG** escalate xuống fallback    │
 * │ `FOUNDATION.FILE.*`. Vừa gắn tệp vào tin là tệp thành module-owned ⇒ thiếu resolver thì:       │
 * │   • `GET /foundation/files/:id/download` 403 cho MỌI người, kể cả người vừa gửi tệp;           │
 * │   • tab "Tệp" của phòng luôn rỗng URL.                                                         │
 * │ Tức là gửi được tệp mà không ai tải được — tính năng chết trong im lặng, đúng lỗi đã ship thật │
 * │ ở `S5-BRAND-BE-1`. Ca test số 1 của WO gỡ đăng ký resolver để chứng minh tính chất này là THẬT.│
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * MÔ HÌNH QUYỀN:
 *   VIEW / DOWNLOAD  ⇐ `view:chat-room` **VÀ** `assertMessageAccess` **VÀ** tin CHƯA thu hồi
 *   LINK             ⇐ `send:chat-message` **VÀ** caller upload chính tệp đó **VÀ** caller là người gửi tin
 *                      **VÀ** phòng chưa lưu trữ **VÀ** tin chưa thu hồi **VÀ** chưa chạm trần tệp
 *   UNLINK / DELETE  ⇐ **KHÔNG BAO GIỜ** (xem jsdoc từng method)
 *
 * ┌─ VÌ SAO THU HỒI KHÔNG GỠ LINK — ĐỌC TRƯỚC KHI "DỌN DẸP" ──────────────────────────────────────┐
 * │ Bản đầu soft-delete `file_links` trong tx thu hồi. Đo bằng probe trên DB thật thì thao tác đó   │
 * │ **MỞ RỘNG** phạm vi tải thay vì thu hẹp: 0 link sống ⇒ `decideForLinkedFile` rơi vào nhánh      │
 * │ `links.length === 0` ⇒ fallback `FOUNDATION.FILE.DOWNLOAD` — cặp mà company-admin ĐANG giữ      │
 * │ (bulk grant `0435`). Người ngoài phòng: **403 trước** thu hồi, **302 sau** thu hồi.             │
 * │                                                                                                 │
 * │ Nên link được GIỮ SỐNG để tệp vẫn là **module-owned** ⇒ mọi quyết định tải vẫn phải hỏi resolver│
 * │ này, và `canRead` từ chối vì `recalled_at IS NOT NULL`. Đường đọc CHAT không đổi: `/messages` và │
 * │ `/pinned` che qua mapper, tab Tệp lọc `recalled_at IS NULL` — cả hai đã có từ trước.            │
 * │                                                                                                 │
 * │ ⚠️ Lỗ "0 link ⇒ tụt về fallback FOUNDATION" **KHÔNG riêng CHAT** — HR contract, task file,       │
 * │ avatar, branding cùng dính. Vá ở tầng FOUNDATION là WO riêng (`S7-FND-LINKFALLBACK-1`), KHÔNG   │
 * │ gộp vào đây vì nó đổi hợp đồng dùng chung của 5 module.                                          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `entityId` của mọi link CHAT là **`chat_messages.id`**, KHÔNG phải `roomId`. Vì thế membership khẳng
 * định bằng `ChatAccessService.assertMessageAccess` — một truy vấn, và nó mang sẵn vị từ SPEC-15 §13.4
 * (`visible_from_seq`) ⇒ tệp của tin nằm TRƯỚC mốc mình vào phòng cũng không tải được. Dùng `assertMember`
 * thay thế sẽ bỏ mất vế đó.
 *
 * ⚠️ KHÔNG viết lại điều kiện membership ở đây. `ChatAccessService` là điểm khẳng định DUY NHẤT của module
 * (`module-closed-by-second-assert-not-scope`); resolver chỉ đổi `NotFoundException` thành `false` vì hợp
 * đồng của policy layer là boolean. Ném ra ngoài cũng an toàn (`decideViaResolver` bắt → `deny-error`),
 * nhưng bắt tại chỗ giữ log sạch cho đường từ chối THƯỜNG GẶP (người ngoài phòng).
 *
 * Resolver CHỈ nhận metadata quyền (`FilePermissionInput`) — không thấy `storage_path`/checksum (CLAUDE §2.3).
 * Đăng ký additively ở `ChatModule.onModuleInit`. KHÔNG đụng `app.module.ts`.
 */
@Injectable()
export class ChatMessageFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = CHAT_MODULE_CODE;
  readonly entityTypes: readonly string[] = [CHAT_MESSAGE_ENTITY_TYPE];

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatAttachmentsRepository,
  ) {}

  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  /**
   * Gắn tệp vào tin qua bề mặt FOUNDATION (`POST /foundation/files/:id/links`) — BA vế cùng đúng.
   *
   * Vế "caller upload chính tệp đó" là chốt chặn TẠI NGUỒN (mirror `MeAvatarFileResolver.canLinkFile` và
   * `CompanyBrandingFileResolver`): thiếu nó, người giữ `link:foundation-file` (seed = company-admin, mig
   * `0005`) gọi thẳng route FOUNDATION với `(CHAT, chat_message, entityId=<tin bất kỳ>)` để gắn tệp NGƯỜI
   * KHÁC (bản scan CCCD/hợp đồng trong tenant) vào một phòng chat — rồi mọi thành viên phòng tải được.
   *
   * Vế "caller là người gửi tin đích" là ràng buộc THÊM của WO này (micro-plan §1.2), đóng lỗ TOÀN VẸN:
   * `attachment_count` đặt lúc INSERT và cột đó **không có GRANT UPDATE** ⇒ mọi link gắn sau đều làm DTO
   * tin (báo N) lệch vĩnh viễn với tab Tệp (liệt kê N+1), không có đường sửa qua API. Không có vế này thì
   * bất kỳ ai giữ `send:chat-message` cũng chèn được tệp vào phát ngôn của người khác.
   *
   * `fileId` vắng (pre-link check) → deny, fail-closed.
   */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAttach(input);
  }

  /**
   * UNLINK: **luôn `false`**.
   *
   * Gỡ tệp khỏi một tin đã gửi CHÍNH LÀ sửa tin — v1 không hỗ trợ (SPEC-15 §3.4 · CHAT-ERR-007). Đường
   * "gỡ" hợp lệ DUY NHẤT là THU HỒI tin; nó **giữ nguyên** hàng `file_links` và chặn ở `canRead` (xem khối
   * "VÌ SAO THU HỒI KHÔNG GỠ LINK" ở jsdoc lớp) — gỡ link thật sẽ trả tệp về fallback FOUNDATION.
   *
   * ⚠️ Phải khai TƯỜNG MINH chứ không được bỏ trống method: `canUnlinkFile` là OPTIONAL trên interface, và
   * resolver KHÔNG cài nó thì policy layer rơi xuống fallback `FOUNDATION.FILE.UNLINK` — cặp mà
   * company-admin ĐANG giữ (bulk grant `0005`) ⇒ company-admin bóc được tệp khỏi tin của bất kỳ ai.
   * Trả `false` là verdict CUỐI (`deny-resolver`, không escalate).
   */
  canUnlinkFile(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * DELETE: **luôn `false`**.
   *
   * Xoá tệp đang là đính kèm của một tin để lại tin trỏ vào hư vô — trong khi `chat_messages` là bảng
   * append-only, không có đường sửa lại. Thu hồi tin **không** làm tệp hết module-owned (link còn sống có
   * chủ đích), nên đường này vẫn `false` sau thu hồi: xoá tệp là việc của FOUNDATION/chủ tệp qua một WO
   * riêng, không phải tác dụng phụ của kênh chat.
   */
  canDeleteFile(): Promise<boolean> {
    return Promise.resolve(false);
  }

  // ─── vế dùng chung ────────────────────────────────────────────────────────────

  /**
   * ĐỌC = cặp `view:chat-room` **VÀ** actor thấy được tin chứa tệp (membership + §13.4).
   *
   * ⚠️ `await` ở vế thứ hai KHÔNG phải chi tiết văn phong: bản đầu viết `this.seesMessage(input) !== null`
   * — so một **Promise** với `null`, luôn `true` ⇒ mọi người giữ `view:chat-room` tải được MỌI tệp đính
   * kèm của MỌI phòng, kể cả phòng mình không thuộc. Typecheck mù với nó (Promise !== null là biểu thức
   * hợp lệ). Unit spec "không thấy tin → từ chối" là thứ bắt được.
   */
  private async canRead(input: FilePermissionInput): Promise<boolean> {
    if (!(await this.hasPair(input, CHAT_READ_PAIR))) return false;
    const acc = await this.seesMessage(input);
    if (acc === null) return false;
    // THU HỒI (SPEC-15 §13.6) — vế này là thứ DUY NHẤT chặn đường tải sau thu hồi, xem jsdoc lớp.
    return acc.message.recalledAt === null;
  }

  /**
   * GHI = cặp `send:chat-message` **VÀ** người gửi tin đích **VÀ** chủ sở hữu tệp **VÀ** ba vế trạng thái
   * dưới đây — vốn là luật của `POST /chat/rooms/:id/messages` mà bề mặt FOUNDATION không hề biết.
   *
   * ⚠️ `POST /foundation/files/:id/links` là ĐƯỜNG GHI THỨ HAI của CHAT: nó không đi qua
   * `ChatMessagesService.sendMessage` nên **không** chịu bất kỳ luật nào của hàm đó. Mọi bất biến mà
   * `sendMessage` ép ở tầng service phải được ép LẠI ở đây, nếu không chúng chỉ là bất biến của MỘT trong
   * hai đường ghi. Ba vế đã bị bỏ sót ở bản đầu (FULL gate bắt, cả ba đo được bằng probe trên DB thật):
   *
   *   • **phòng lưu trữ** — `sendMessage` chặn bằng CHAT-ERR-005; thiếu ở đây thì gắn được nội dung MỚI
   *     vào phòng chỉ-đọc, và tệp hiện luôn ở tab Tệp kèm URL ký (probe: link vào phòng archived → 201).
   *   • **tin đã thu hồi** — gắn lại tệp vào tin đã thu hồi làm link sống lại ⇒ mở lại đường tải cho MỌI
   *     thành viên phòng, trong khi `/messages` và tab Tệp đều vẫn giấu tin đó.
   *   • **trần `CHAT_MAX_ATTACHMENTS_PER_MESSAGE`** — `sendMessage` ép ở Zod (`fileIds.max(10)`). Trần này
   *     là ĐIỀU KIỆN TIÊN QUYẾT của `trimToMessageBoundary`: một tin mang nhiều link hơn kích thước trang
   *     làm hàm đó trả về trang không cắt được, con trỏ kế nhảy qua luôn phần còn lại ⇒ **tệp biến mất im
   *     lặng** khỏi tab Tệp, đúng thứ hàm ấy sinh ra để chặn.
   *
   * `fileId` vắng (pre-link check) → deny trước khi tốn truy vấn nào (fail-closed).
   */
  private async canAttach(input: FilePermissionInput): Promise<boolean> {
    if (!input.fileId) return false;
    const fileId = input.fileId;
    if (!(await this.hasPair(input, CHAT_SEND_PAIR))) return false;

    const acc = await this.seesMessage(input);
    if (acc === null) return false;
    if (acc.message.senderId !== input.userId) return false;
    if (acc.room.isArchived) return false;
    if (acc.message.recalledAt !== null) return false;

    const [owned, linked] = await this.db.withTenant(input.companyId, async (tx) => [
      await this.repo.findOwnedFiles(tx, input.companyId, input.userId, [fileId]),
      await this.repo.countActiveLinks(tx, input.companyId, input.entityId),
    ]);
    if (linked >= CHAT_MAX_ATTACHMENTS_PER_MESSAGE) return false;
    return owned.length === 1 && isAttachableFile(owned[0]);
  }

  private async hasPair(
    input: FilePermissionInput,
    pair: { action: string; resourceType: string },
  ): Promise<boolean> {
    const decision = await this.permission.can({
      userId: input.userId,
      companyId: input.companyId,
      action: pair.action,
      resourceType: pair.resourceType,
    });
    return decision.allow;
  }

  /**
   * `senderId` của tin nếu actor ĐƯỢC THẤY nó, `null` nếu không (tin không tồn tại · tenant khác · phòng
   * đã xoá mềm · actor không/không-còn là thành viên · tin trước `visible_from_seq`).
   *
   * Nuốt ĐÚNG `NotFoundException` (hằng 404 của `ChatAccessService`) — mọi lỗi khác ném tiếp để
   * `decideViaResolver` biến thành `deny-error` CÓ LOG. Nuốt trắng mọi exception ở đây là biến một sự cố
   * DB thật thành "không có quyền" trong im lặng (silent-failure-hunter).
   */
  private async seesMessage(input: FilePermissionInput): Promise<ChatMessageAccess | null> {
    try {
      return await this.db.withTenant(input.companyId, (tx) =>
        this.access.assertMessageAccess(tx, input.companyId, input.entityId, input.userId),
      );
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/**
 * Nhận diện 404 mà KHÔNG `instanceof NotFoundException`: `withTenant` có thể bọc lại lỗi, và ở worker
 * vitest hai bản `@nestjs/common` khác instance làm `instanceof` trượt trong im lặng ⇒ deny-error thay vì
 * deny sạch. Soi `getStatus()` là bất biến qua mọi cách bọc.
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { getStatus?: unknown; status?: unknown };
  if (typeof candidate.getStatus === "function") {
    return (candidate.getStatus as () => number)() === 404;
  }
  return candidate.status === 404;
}

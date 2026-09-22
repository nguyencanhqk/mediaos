import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_IMAGES_PER_POST,
  FEED_MAX_VIDEOS_PER_POST,
  type FeedAttachmentDto,
  type FeedAttachmentKindDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { fileLinks, files } from "../db/schema/files";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { FilePolicyAction } from "../foundation/files/file-policy.types";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter.port";
import { FEED_COMMENT_ENTITY, FEED_POST_ENTITY, SOCIAL_MODULE } from "./social-file.resolver";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialTargetType, SocialViewerContext } from "./social.types";

/** `scan_status` được phép gắn — mirror `SocialFileResolver.LINKABLE_SCAN`. */
const LINKABLE_SCAN = new Set(["Clean", "NotRequired"]);
/**
 * `file_links.link_type` — mirror `chk_file_links_link_type`, tập giá trị VIẾT HOA
 * (`Avatar|Attachment|Contract|Proof|Document|Import|Export|Other`).
 *
 * ⚠️ Chữ thường (`"attachment"`) vỡ CHECK thành **500 vô danh**, và drizzle giấu mã PG trong
 * `error.cause` nên log chỉ hiện "Failed query: insert into file_links …" — không có chữ nào nói
 * ràng buộc nào vỡ.
 */
const LINK_TYPE = "Attachment";

/**
 * S16-SOCIAL-BE-1 (plan §2 D18) — đính kèm ảnh/video cho bài & bình luận.
 *
 * ┌─ VÌ SAO KHÔNG GỌI `FileService.link()` ────────────────────────────────────────────────────────┐
 * │ `FileService.link` hỏi `policy.canLink` **NGOÀI mọi transaction** (`files.service.ts:549` trước  │
 * │ `:574`) và resolver bên trong lại tự mở `withTenant` riêng. Gọi nó từ trong transaction nghiệp   │
 * │ vụ = `withTenant` lồng `withTenant` ⇒ chiếm client thứ hai từ pool khi client thứ nhất còn giữ   │
 * │ transaction, và trên **PgBouncer transaction-mode nó TREO chứ không báo lỗi**.                   │
 * │ Gọi nó SAU commit thì mất tính nguyên tử: bài đã đăng, tệp gắn hỏng, không có đường lùi.         │
 * │ ⇒ Ở đây ta ghi `file_links` TRONG CÙNG tx, và ép LẠI ĐÚNG các vế mà `SocialFileResolver          │
 * │ .canLinkFile` ép — bằng cách dùng CHUNG `assertLinkableFilesTx` dưới đây, không phải bằng một    │
 * │ bản sao. Resolver vẫn là cổng của đường ghi đi qua route FOUNDATION.                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KÝ URL PHẢI Ở NGOÀI TRANSACTION** — cùng lý do `withTenant` lồng nhau ở trên
 * (`chat-attachments.service.ts:79-83`). Mọi caller: đọc row TRONG tx → commit → gọi `decorate*`.
 */
@Injectable()
export class SocialAttachmentsService {
  private readonly logger = new Logger(SocialAttachmentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: FilePolicyService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Ép MỌI vế của đường gắn tệp, TRONG tx nghiệp vụ. Ném 422 `SOCIAL-ERR-007` ở mọi nhánh hỏng.
   *
   * Vế 2-5 trùng ĐÚNG với `SocialFileResolver.canLinkFile` (xem jsdoc ở đó để biết vì sao từng vế
   * tồn tại). Vế giới hạn số lượng/dung lượng là của SPEC-16 §16 và chỉ có ở đây — resolver không
   * đếm được "bài này đã có mấy ảnh".
   *
   * ⚠️ Thông điệp lỗi CỐ Ý không nói tệp nào hỏng vì lý do gì: `fileId` do client gửi lên, nhưng
   * "tệp này tồn tại nhưng không phải của bạn" và "tệp này không tồn tại" phải không phân biệt được
   * — nếu không, vòng lặp đoán UUID đọc được kho tệp của cả công ty.
   */
  async assertLinkableFilesTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    fileIds: readonly string[],
  ): Promise<FileRow[]> {
    if (fileIds.length === 0) return [];
    const unique = [...new Set(fileIds)];

    const rows = await tx
      .select({
        id: files.id,
        originalName: files.originalName,
        mimeType: files.mimeType,
        fileSizeBytes: files.fileSizeBytes,
        storagePath: files.storagePath,
        uploadStatus: files.uploadStatus,
        scanStatus: files.scanStatus,
        ownerUserId: files.ownerUserId,
      })
      .from(files)
      .where(
        and(eq(files.companyId, companyId), inArray(files.id, unique), isNull(files.deletedAt)),
      );

    // Thiếu tệp nào ⇒ hỏng — KHÔNG "bỏ qua tệp không tìm thấy": bỏ qua im lặng làm người dùng đăng
    // bài rồi phát hiện ảnh biến mất, không lỗi, không cách nào biết vì sao.
    if (rows.length !== unique.length) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID);
    }
    for (const f of rows) {
      if (f.ownerUserId !== userId)
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 2
      if (f.uploadStatus !== "Uploaded")
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 3
      if (!LINKABLE_SCAN.has(f.scanStatus))
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 4
      if (f.fileSizeBytes > FEED_MAX_ATTACHMENT_BYTES)
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_LIMIT);
    }

    // vế 5 — tệp CHƯA TỪNG có link nào (kể cả link đã gỡ). `deleted_at` KHÔNG lọc ở đây có chủ đích:
    // câu hỏi là "đã từng", không phải "đang".
    const everLinked = await tx
      .select({ fileId: fileLinks.fileId })
      .from(fileLinks)
      .where(and(eq(fileLinks.companyId, companyId), inArray(fileLinks.fileId, unique)));
    if (everLinked.length > 0) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID);
    }

    // Giới hạn SPEC-16 §16 theo LOẠI.
    const images = rows.filter((f) => kindOf(f.mimeType) === "image").length;
    const videos = rows.filter((f) => kindOf(f.mimeType) === "video").length;
    if (images > FEED_MAX_IMAGES_PER_POST || videos > FEED_MAX_VIDEOS_PER_POST) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_LIMIT);
    }

    return rows;
  }

  /**
   * Ghi `file_links` cho một nội dung, TRONG tx. Dùng lúc TẠO (tập rỗng ban đầu) và lúc SỬA (thay
   * toàn bộ tập).
   *
   * Lúc sửa: link cũ bị **gỡ mềm** (`deleted_at`), không xoá cứng — `file_links` là vết của việc
   * "tệp này đã từng thuộc về đâu", và vế 5 ở trên dựa vào chính vết đó để chặn tái-link.
   */
  async syncLinksTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    targetType: SocialTargetType,
    targetId: string,
    fileIds: readonly string[],
  ): Promise<void> {
    const entityType = targetType === "post" ? FEED_POST_ENTITY : FEED_COMMENT_ENTITY;

    const current = await tx
      .select({ id: fileLinks.id, fileId: fileLinks.fileId })
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, SOCIAL_MODULE),
          eq(fileLinks.entityType, entityType),
          eq(fileLinks.entityId, targetId),
          isNull(fileLinks.deletedAt),
        ),
      );
    const had = new Set(current.map((r) => r.fileId));
    const wanted = new Set(fileIds);

    const toUnlink = current.filter((r) => !wanted.has(r.fileId));
    if (toUnlink.length > 0) {
      await tx
        .update(fileLinks)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(fileLinks.companyId, companyId),
            inArray(
              fileLinks.id,
              toUnlink.map((r) => r.id),
            ),
          ),
        );
    }

    const toAdd = [...wanted].filter((id) => !had.has(id));
    if (toAdd.length === 0) return;

    // Chỉ tệp MỚI mới đi qua cổng — tệp đã gắn từ trước đã qua rồi, và bắt nó qua lại sẽ đỏ ở vế 5
    // ("đã từng có link" — chính là link của nó).
    await this.assertLinkableFilesTx(tx, companyId, userId, toAdd);

    await tx.insert(fileLinks).values(
      toAdd.map((fileId, i) => ({
        companyId,
        fileId,
        moduleCode: SOCIAL_MODULE,
        entityType,
        entityId: targetId,
        linkType: LINK_TYPE,
        sortOrder: i,
        createdBy: userId,
      })),
    );
  }

  /**
   * `targetId → đính kèm ĐÃ KÝ cho CHÍNH người gọi`. **GỌI SAU KHI tx đã commit.**
   *
   * Một truy vấn cho cả lô (không phải một truy vấn mỗi bài), rồi một quyết định policy mỗi TỆP.
   */
  async decorateMany(
    viewer: SocialViewerContext,
    targetType: SocialTargetType,
    targetIds: readonly string[],
  ): Promise<Map<string, FeedAttachmentDto[]>> {
    const out = new Map<string, FeedAttachmentDto[]>();
    if (targetIds.length === 0) return out;
    const entityType = targetType === "post" ? FEED_POST_ENTITY : FEED_COMMENT_ENTITY;

    const rows = await this.db.withTenant(viewer.companyId, (tx) =>
      tx
        .select({
          entityId: fileLinks.entityId,
          fileId: files.id,
          originalName: files.originalName,
          mimeType: files.mimeType,
          fileSizeBytes: files.fileSizeBytes,
          storagePath: files.storagePath,
          sortOrder: fileLinks.sortOrder,
        })
        .from(fileLinks)
        .innerJoin(
          files,
          and(eq(files.id, fileLinks.fileId), eq(files.companyId, fileLinks.companyId)),
        )
        .where(
          and(
            eq(fileLinks.companyId, viewer.companyId),
            eq(fileLinks.moduleCode, SOCIAL_MODULE),
            eq(fileLinks.entityType, entityType),
            inArray(fileLinks.entityId, [...targetIds]),
            isNull(fileLinks.deletedAt),
            isNull(files.deletedAt),
          ),
        ),
    );
    if (rows.length === 0) return out;

    // Luật AND của `decideForLinkedFile` chỉ đúng khi thấy ĐỦ link của tệp — kể cả link của module
    // khác. Truy vấn này vì vậy KHÔNG lọc `module_code`.
    const fileIds = [...new Set(rows.map((r) => r.fileId))];
    const linksByFile = await this.db.withTenant(viewer.companyId, async (tx) => {
      const all = await tx
        .select({
          fileId: fileLinks.fileId,
          moduleCode: fileLinks.moduleCode,
          entityType: fileLinks.entityType,
          entityId: fileLinks.entityId,
        })
        .from(fileLinks)
        .where(
          and(
            eq(fileLinks.companyId, viewer.companyId),
            inArray(fileLinks.fileId, fileIds),
            isNull(fileLinks.deletedAt),
          ),
        );
      const map = new Map<string, { moduleCode: string; entityType: string; entityId: string }[]>();
      for (const l of all) {
        const list = map.get(l.fileId) ?? [];
        list.push({ moduleCode: l.moduleCode, entityType: l.entityType, entityId: l.entityId });
        map.set(l.fileId, list);
      }
      return map;
    });

    const urlByFile = new Map<string, string | null>();
    for (const row of rows) {
      if (urlByFile.has(row.fileId)) continue;
      urlByFile.set(
        row.fileId,
        await this.signOne(viewer, row, entityType, linksByFile.get(row.fileId) ?? []),
      );
    }

    for (const row of rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const list = out.get(row.entityId) ?? [];
      list.push({
        fileId: row.fileId,
        kind: kindOf(row.mimeType),
        fileName: row.originalName,
        sizeBytes: row.fileSizeBytes,
        url: urlByFile.get(row.fileId) ?? null,
      });
      out.set(row.entityId, list);
    }
    return out;
  }

  /** `null` = không ký được (mọi lý do). KHÔNG ném — fail-soft CÓ LOG, khuôn CHAT. */
  private async signOne(
    viewer: SocialViewerContext,
    row: { fileId: string; storagePath: string },
    entityType: string,
    links: readonly { moduleCode: string; entityType: string; entityId: string }[],
  ): Promise<string | null> {
    try {
      // 0 link = tệp đã rời mọi entity ⇒ KHÔNG ký (chặn sớm, rẻ hơn, không phụ thuộc cờ caller truyền).
      if (links.length === 0) return null;
      const decision = await this.policy.decideForLinkedFile(
        {
          companyId: viewer.companyId,
          userId: viewer.actorUserId,
          fileId: row.fileId,
          moduleCode: SOCIAL_MODULE,
          entityType,
          entityId: links[0].entityId,
          action: FilePolicyAction.Download,
        },
        links,
        FilePolicyAction.Download,
        // `everLinked` chỉ dùng khi `links` RỖNG — đã chặn ở trên. `true` để nếu ai gỡ đai kia thì
        // hành vi rơi về FAIL-CLOSED (`deny-links-revoked`) chứ không mở fallback FOUNDATION.FILE.*.
        true,
      );
      if (!decision.allow) {
        // `deny-no-resolver`/`deny-error` = resolver rơi khỏi đăng ký ⇒ tính năng chết trong im lặng,
        // phải kêu to. `deny-resolver` là từ chối THƯỜNG GẶP (không thấy được bài) — không log ồn.
        if (decision.reason === "deny-no-resolver" || decision.reason === "deny-error") {
          this.logger.error(
            `social attachment presign denied: reason=${decision.reason} file=${row.fileId} — ` +
              `resolver SOCIAL/${entityType} còn đăng ký không?`,
          );
        }
        return null;
      }
      const signed = await this.storage.get({
        key: row.storagePath,
        companyId: viewer.companyId,
      });
      return signed.url;
    } catch (err) {
      // Degrade CÓ LOG (không nuốt im lặng): storage lỗi/cấu hình thiếu ⇒ tệp hiện "không tải được",
      // dòng cuộn vẫn trả. Kèm lý do để một BUG THẬT không lẩn sau fail-soft.
      this.logger.warn(
        `social attachment presign failed: file=${row.fileId} — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
  }
}

interface FileRow {
  id: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  uploadStatus: string;
  scanStatus: string;
  ownerUserId: string | null;
}

/**
 * Phân loại đính kèm từ `mime_type` — **suy ở SERVER**, client không gửi lên.
 *
 * Client gửi `kind` nghĩa là client quyết định giới hạn nào áp cho tệp của mình: khai một video là
 * `image` để lách trần «1 video/bài».
 */
export function kindOf(mimeType: string): FeedAttachmentKindDto {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}

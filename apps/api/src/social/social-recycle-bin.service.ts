import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  FeedPostRestoreResultDto,
  FeedRecycleBinItemDto,
  FeedRecycleBinPageDto,
  FeedRecycleBinQueryDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { RecycleBinRegistry } from "../recycle-bin/recycle-bin.registry";
import type { FeedPostRecycleBinHandler } from "../recycle-bin/recycle-bin.types";
import { SocialAccessService } from "./social-access.service";
import { restorePostTx } from "./social-counters";
import {
  SocialRecycleBinRepository,
  type RecycleBinPostRow,
} from "./social-recycle-bin.repository";
import { SOCIAL_ERR, socialError } from "./social.errors";
import type { SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-3C — handler `feed_post` của thùng rác: `SOCIAL-API-057` (liệt kê) · `058` (khôi phục).
 * Route sống ở `recycle-bin/` (owner ký O3); lớp này tự đăng ký vào `RecycleBinRegistry` ở `onModuleInit`.
 *
 * ── CỔNG ── `resolveActor` (tầng 2, cặp `restore:feed-post`, `companyFloor:true`) chạy **NGOÀI** `withTenant`
 * (nó tự mở transaction đọc grant riêng — lồng tx trên PgBouncer là treo IM LẶNG). `Department`/`Own` ⇒ 403
 * `AUTH-ERR-SCOPE-DENIED` TRƯỚC mọi truy vấn ⇒ 0 side-effect. `manage:feed-post` một mình KHÔNG mở được hai
 * route này (O1 — int-spec D2c).
 *
 * ── KHÔNG TÁC DỤNG PHỤ NGOÀI DANH SÁCH ĐÓNG (D14) ── KHÔNG phát WS (xoá cũng không phát; phát lại
 * `feed.post.created` sẽ đẩy một bài có thể `hidden` ra audience) · KHÔNG gửi lại NOTI mention/kudos/news ·
 * KHÔNG đụng `file_links`/mentions/saved/acks/reactions (chúng chưa từng bị xoá theo bài ⇒ trả lại đủ).
 * Lớp này vì vậy KHÔNG inject `RealtimeEmitterService`/`OutboxService` — thêm vào là đổi hợp đồng D14.
 */
@Injectable()
export class SocialRecycleBinService implements OnModuleInit, FeedPostRecycleBinHandler {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialRecycleBinRepository,
    private readonly audit: AuditService,
    private readonly registry: RecycleBinRegistry,
  ) {}

  /**
   * Tự đăng ký (khuôn `SocialSeedRegistrar`). Thiếu dòng này ⇒ `RecycleBinRegistry.get` ném ⇒ `057`/`058` 500
   * (fail-closed, KHÔNG thùng rác rỗng im lặng) — mutant M6 / int-spec A1.
   */
  onModuleInit(): void {
    this.registry.register("feed_post", this);
  }

  /** `057` — `GET /recycle-bin/feed-posts`. KHÔNG audit (đọc quản trị, không đổi dữ liệu). */
  async list(
    user: SocialRequestUser,
    query: FeedRecycleBinQueryDto,
  ): Promise<FeedRecycleBinPageDto> {
    const actor = await this.access.resolveActor(user, "recycleFeedPostList");
    const { rows, total } = await this.db.withTenant(actor.companyId, async (tx) => ({
      rows: await this.repo.listDeletedTx(tx, actor, query.page, query.limit),
      total: await this.repo.countDeletedTx(tx, actor.companyId),
    }));
    return { data: rows.map(toItem), page: query.page, limit: query.limit, total };
  }

  /**
   * `058` — `POST /recycle-bin/feed-posts/{post_id}/restore`. Thứ tự TRONG một tx (D12):
   * khoá hàng đã xoá → không hàng ⇒ 404 → nhóm chết ⇒ 409 → `restorePostTx` (luật trạng thái D4) → audit.
   *
   * 404 MỘT chuỗi cho mọi lý do (không tồn tại · tenant khác · CHƯA xoá · lượt đua đã khôi phục) — cùng luật
   * chống-oracle của `POST_NOT_FOUND`. Tác giả nghỉ việc / `org_unit` đã xoá KHÔNG chặn (int-spec A11).
   *
   * Audit LUÔN, CÙNG tx (D13): khôi phục là thao tác kiểm duyệt lên nội dung — kể cả khi HR khôi phục bài của
   * chính mình. `metadata` không chở nội dung bài.
   */
  async restore(user: SocialRequestUser, postId: string): Promise<FeedPostRestoreResultDto> {
    const actor = await this.access.resolveActor(user, "recycleFeedPostRestore");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.repo.lockDeletedForRestoreTx(tx, actor.companyId, postId);
      if (!post) throw new NotFoundException(socialError(SOCIAL_ERR.POST_NOT_FOUND));
      if (post.groupId !== null && post.groupDeletedAt !== null) {
        throw new ConflictException(socialError(SOCIAL_ERR.RESTORE_GROUP_DELETED));
      }

      const status = await restorePostTx(tx, actor.companyId, post.id, actor.actorUserId);
      if (status === null) {
        // Bất khả: hàng vừa được khoá `FOR UPDATE` trong CÙNG tx với vế `deleted_at IS NOT NULL`. Ném ⇒ tx quay
        // lui — thà 500 ồn còn hơn một 200 cho một lượt khôi phục không khớp hàng nào (thành công RỖNG).
        throw new Error(
          `SocialRecycleBinService.restore: hàng đã khoá mà restorePostTx khớp 0 (${post.id})`,
        );
      }

      const deletedByAuthor = post.deletedBy !== null && post.deletedBy === post.authorUserId;
      await this.audit.record(tx, {
        action: "social.post.restore",
        objectType: "feed_post",
        objectId: post.id,
        actorUserId: actor.actorUserId,
        moduleCode: "SOCIAL",
        entityType: "feed_post",
        entityId: post.id,
        resultStatus: "Success",
        // KHÔNG nội dung bài — API-19 §8 chốt payload audit chỉ mang id + trường đổi.
        metadata: {
          postId: post.id,
          authorUserId: post.authorUserId,
          restoredStatus: status,
          statusBeforeDelete: post.statusBeforeDelete,
          deletedByAuthor,
        },
      });
      return { id: post.id, status };
    });
  }
}

/**
 * Hàng thô → DTO. Bỏ cờ `authorInScope` (siêu dữ liệu phân quyền — KHÔNG lọt response, `identity-projection.ts`)
 * và gói `author` thành `null` khi ngoài phạm vi: SQL đã khử cột (`case when`), bước này chỉ đổi HÌNH DẠNG.
 */
function toItem(row: RecycleBinPostRow): FeedRecycleBinItemDto {
  return {
    id: row.id,
    type: row.type as FeedRecycleBinItemDto["type"],
    audience: row.audience as FeedRecycleBinItemDto["audience"],
    groupId: row.groupId,
    groupDeleted: row.groupDeleted,
    orgUnitId: row.orgUnitId,
    author: row.authorInScope ? { employeeId: row.employeeId, fullName: row.fullName } : null,
    bodyExcerpt: row.bodyExcerpt,
    statusBeforeDelete: row.statusBeforeDelete,
    restoreAs: row.restoreAs,
    deletedAt: toIso(row.deletedAt),
    deletedByAuthor: row.deletedByAuthor,
    createdAt: toIso(row.createdAt),
  };
}

/** `timestamptz` qua builder về `Date`; ném thay vì trả chuỗi rỗng nếu hợp đồng driver đổi. */
function toIso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`SocialRecycleBinService: mốc thời gian không hợp lệ: ${String(value)}`);
  }
  return value.toISOString();
}

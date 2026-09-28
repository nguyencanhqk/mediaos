import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { FEED_RECYCLE_EXCERPT_MAX } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles, users } from "../db/schema";
import { feedGroups, feedPosts } from "../db/schema/social";
import { fromScope, identityColumns } from "../permission/identity-projection";
import { audienceCondition } from "./social-audience.predicate";
import { restoreStatusSql } from "./social-counters";
import type { SocialActor } from "./social.types";

/** Vị từ TẬP HÀNG của thùng rác — dùng CHUNG cho trang và `total` (hai câu đếm hai tập là trang nói dối). */
const deletedInTenant = (companyId: string): SQL =>
  and(eq(feedPosts.companyId, companyId), isNotNull(feedPosts.deletedAt)) ?? sql`false`;

/** Một hàng thô của `057` trước khi service chiếu ra DTO (bỏ cờ `authorInScope`, đổi ngày sang ISO). */
export interface RecycleBinPostRow {
  id: string;
  type: string;
  audience: string;
  groupId: string | null;
  groupDeleted: boolean;
  orgUnitId: string | null;
  bodyExcerpt: string | null;
  statusBeforeDelete: "published" | "hidden" | null;
  restoreAs: "published" | "hidden";
  deletedAt: Date;
  deletedByAuthor: boolean;
  createdAt: Date;
  authorInScope: boolean;
  fullName: string | null;
  employeeId: string | null;
}

/** Hàng đã khoá của `058` — đúng những gì service cần để quyết định 404/409 và ghi audit. */
export interface LockedDeletedPost {
  id: string;
  authorUserId: string;
  deletedBy: string | null;
  statusBeforeDelete: "published" | "hidden" | null;
  groupId: string | null;
  groupDeletedAt: Date | null;
}

/**
 * S16-SOCIAL-BE-3C — truy vấn thùng rác bài viết (`SOCIAL-API-057` / `058`).
 *
 * ┌─ 🔴 CHE BẰNG SQL, KHÔNG BẰNG JS (D10) ──────────────────────────────────────────────────────────┐
 * │ Tập HÀNG gác bởi `restore:feed-post` + sàn Company (tầng 2 ở service). Nhưng `manage:feed-post` —   │
 * │ và vì thế `restore:feed-post` — chỉ đọc tác giả/nội dung của một bài QUA `visiblePostCondition`:      │
 * │ nó KHÔNG thấy bài nhóm kín khi không là thành viên, KHÔNG thấy bài `org_unit` đơn vị khác. Thùng rác │
 * │ không được mở đường vòng qua SOC-DEC-006 ⇒ bốn trường (`author` · `groupId` · `orgUnitId` ·         │
 * │ `bodyExcerpt`) che bằng `seen = audienceCondition(actor)` — CÙNG hàm với vế (c) của                 │
 * │ `visiblePostCondition`, không phải bản chép. Hàng VẪN được liệt kê (id · type · audience ·          │
 * │ `groupDeleted` · thời điểm · `restoreAs`) để HR khôi phục theo yêu cầu.                            │
 * │ Khử ở SQL (`case when`) chứ không xoá khoá ở service: quên bước xoá khoá thì hàng ngoài phạm vi trả │
 * │ `null` thay vì rò im lặng — chế độ hỏng ỒN ÀO có chủ đích (khuôn `recycle-bin.repository.ts`).      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `author` + `bodyExcerpt` còn đòi thêm vế status ĐÃ NHỚ (`contentVisible` bên dưới) — `groupId`/`orgUnitId` chỉ
 * theo `seen`. Danh tính tác giả đi qua cơ chế chuẩn `identityColumns(fromScope(contentVisible, "identity-gated",
 * …))` (D11) — KHÔNG `target`: vị từ nói về `feed_posts`, không về `users`, nên phép đối chiếu bảng không áp dụng. ⚠️ KHÔNG
 * `"scoped-predicate"`: đó là điểm đúc vị từ chặn TẬP HÀNG (`ROW_SCOPE_MINT_PINS`, danh sách đúng-bằng) — ở đây
 * vị từ chỉ chặn CỘT, tập hàng theo cặp khác ⇒ đúng định nghĩa `identity-gated`.
 *
 * ⚠️ Câu viết bằng builder, nội suy cột qua đối tượng cột (`${users.fullName}` trong `identityColumns`) —
 * CẤM template SQL thô chứa tên cột danh tính (vùng mù `rawSqlIdentity` của ratchet danh tính).
 *
 * ⚠️ Mọi JOIN ghim tenant TƯỜNG MINH (`company_id` hai bên) — belt-and-suspenders trên RLS: một lần RLS bị tắt
 * nhầm ở migration là mọi JOIN chỉ nối `id` mở sang tenant khác. KHÔNG alias `feed_posts` ⇒ `restoreStatusSql()`
 * và `audienceCondition(actor)` dùng tham số mặc định.
 */
@Injectable()
export class SocialRecycleBinRepository {
  /** `057` — một trang thùng rác, `ORDER BY deleted_at DESC, id DESC` (khớp `idx_feed_posts_company_deleted`). */
  async listDeletedTx(
    tx: TenantTx,
    actor: SocialActor,
    page: number,
    limit: number,
  ): Promise<RecycleBinPostRow[]> {
    const seen = audienceCondition(actor);
    // Tác giả + trích đoạn đòi thêm vế STATUS (D10-ii, mirror vế (b) `statusOk` của `visiblePostCondition` trên
    // status ĐÃ NHỚ): bài từng `hidden` chỉ lộ cho người vốn đọc được bài `hidden` khi nó còn sống —
    // `manage:feed-post` hoặc chính tác giả. Legacy NULL ⇒ coi như chưa biết là `published` ⇒ che (fail-closed).
    // ⚠️ Danh tính đi CÙNG vị từ này, không chỉ `seen` (FULL gate BE-3C security MEDIUM): chiếu tên tác giả
    // của bài từng `hidden` cho vai thiếu `manage` là lộ «bài của X từng bị kiểm duyệt ẩn».
    const contentVisible: SQL = actor.canManagePosts
      ? seen
      : (and(
          seen,
          or(
            eq(feedPosts.statusBeforeDelete, "published"),
            eq(feedPosts.authorUserId, actor.actorUserId),
          ),
        ) ?? sql`false`);
    const author = identityColumns(
      fromScope(
        contentVisible,
        "identity-gated",
        "thùng rác bài viết (SOCIAL-API-057): tên tác giả chỉ hiện khi actor vốn thấy bài lúc còn sống — " +
          "audience (vế (c) `visiblePostCondition`) + status đã nhớ (vế (b)); tập hàng gác " +
          "`restore:feed-post` + sàn Company",
      ),
      { fullName: users.fullName, employeeId: employeeProfiles.id },
      "authorInScope",
    );

    const rows = await tx
      .select({
        id: feedPosts.id,
        type: feedPosts.type,
        audience: feedPosts.audience,
        groupId: sql<string | null>`case when (${seen}) then ${feedPosts.groupId} else null end`,
        groupDeleted: sql<boolean>`(${feedGroups.deletedAt} IS NOT NULL)`,
        orgUnitId: sql<
          string | null
        >`case when (${seen}) then ${feedPosts.orgUnitId} else null end`,
        bodyExcerpt: sql<string | null>`case when (${contentVisible})
          then left(${feedPosts.body}, ${FEED_RECYCLE_EXCERPT_MAX}) else null end`,
        statusBeforeDelete: feedPosts.statusBeforeDelete,
        restoreAs: restoreStatusSql(),
        deletedAt: feedPosts.deletedAt,
        deletedByAuthor: sql<boolean>`(${feedPosts.deletedBy} IS NOT NULL
          AND ${feedPosts.deletedBy} = ${feedPosts.authorUserId})`,
        createdAt: feedPosts.createdAt,
        ...author,
      })
      .from(feedPosts)
      .innerJoin(
        users,
        and(eq(users.id, feedPosts.authorUserId), eq(users.companyId, feedPosts.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, feedPosts.authorEmployeeId),
          eq(employeeProfiles.companyId, feedPosts.companyId),
        ),
      )
      .leftJoin(
        feedGroups,
        and(eq(feedGroups.id, feedPosts.groupId), eq(feedGroups.companyId, feedPosts.companyId)),
      )
      .where(deletedInTenant(actor.companyId))
      .orderBy(desc(feedPosts.deletedAt), desc(feedPosts.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return rows as RecycleBinPostRow[];
  }

  /** `057` — `total` đếm bằng CHÍNH vị từ tập hàng của trang (không JOIN: `users` là inner nhưng FK NOT NULL). */
  async countDeletedTx(tx: TenantTx, companyId: string): Promise<number> {
    const [row] = await tx.select({ n: count() }).from(feedPosts).where(deletedInTenant(companyId));
    return Number(row?.n ?? 0);
  }

  /**
   * `058` — khoá hàng bài ĐÃ XOÁ (`FOR UPDATE OF feed_posts`) + đọc trạng thái nhóm, CÙNG tx với câu khôi phục.
   *
   * Hai lượt khôi phục đua nhau: lượt thua chờ khoá, rồi (READ COMMITTED) đánh giá lại vế `deleted_at IS NOT
   * NULL` trên phiên bản mới ⇒ 0 hàng ⇒ 404, 0 audit (int-spec D6). `OF feed_posts` là bắt buộc: Postgres cấm
   * `FOR UPDATE` trên phía NULL-được của LEFT JOIN, và khoá nhóm không phải việc của câu này (đua với xoá
   * nhóm là lành — bài khôi phục vào nhóm vừa chết cũng là trạng thái của mọi bài còn sống lúc nhóm bị xoá).
   *
   * `null` ⇔ không tồn tại · tenant khác · CHƯA xoá · lượt đua đã khôi phục trước — MỘT kết cục cho mọi lý do.
   */
  async lockDeletedForRestoreTx(
    tx: TenantTx,
    companyId: string,
    postId: string,
  ): Promise<LockedDeletedPost | null> {
    const rows = await tx
      .select({
        id: feedPosts.id,
        authorUserId: feedPosts.authorUserId,
        deletedBy: feedPosts.deletedBy,
        statusBeforeDelete: feedPosts.statusBeforeDelete,
        groupId: feedPosts.groupId,
        groupDeletedAt: feedGroups.deletedAt,
      })
      .from(feedPosts)
      .leftJoin(
        feedGroups,
        and(eq(feedGroups.id, feedPosts.groupId), eq(feedGroups.companyId, feedPosts.companyId)),
      )
      .where(and(eq(feedPosts.id, postId), deletedInTenant(companyId)))
      .limit(1)
      .for("update", { of: feedPosts });
    return (rows[0] as LockedDeletedPost | undefined) ?? null;
  }
}

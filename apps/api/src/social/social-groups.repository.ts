import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ListFeedGroupsQueryDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { feedGroupMembers, feedGroups } from "../db/schema/social";
import type { FeedGroupRole, SocialGroupActor } from "./social.types";

/**
 * S16-SOCIAL-BE-2A — truy vấn THỰC THỂ `feed_groups` (`030`/`031`/`032`/`033`/`034`).
 *
 * Tách khỏi `social-group-members.repository.ts` ngay từ đầu: hai BẢNG, hai vòng đời (nhóm xoá MỀM,
 * thành viên xoá CỨNG — DB-17 §4.9), và gộp lại thì file chạm trần 800 dòng trước khi BE-2B mở.
 *
 * ┌─ 🔴 LUẬT D13 ÁP CHO MỌI CÂU TRONG FILE NÀY ────────────────────────────────────────────────────┐
 * │ Mọi vị từ chạm `feed_groups` mang **`deleted_at IS NULL`**. Thiếu nó: sau `034`, nhóm đã xoá     │
 * │ vẫn hiện ở `030`, vẫn đọc được qua `032`, vẫn sửa được qua `033`.                               │
 * │ Hai MIỄN TRỪ có chủ ý nằm ở NƠI KHÁC và đã ghi lý do tại chỗ: neo `lockGroupRowTx` (W4) và       │
 * │ `bumpGroupMemberCount` (bảo trì bộ đếm) — KHÔNG phải trong file này.                            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Mọi method nhận `tx` của caller — KHÔNG tự mở `withTenant` (lồng tx = treo im lặng trên
 * PgBouncer transaction-mode; cùng luật đã ghi ở `social-group-access.service.ts`).
 */
@Injectable()
export class SocialGroupsRepository {
  /**
   * `SOCIAL-API-030` — danh sách nhóm, phân trang OFFSET.
   *
   * 🔴 **PHẠM VI NHÌN THẤY (G10)** — ba nhánh, khai TƯỜNG MINH chứ không để một `undefined` rơi
   * xuống thành "không lọc":
   *   • `membership='mine'` → CHỈ nhóm actor là thành viên `active` (kể cả nhóm `private`).
   *   • `membership='all'` + actor thường → nhóm `public` **∪** nhóm actor **CÓ HÀNG** thành viên
   *     (`active` **hoặc `pending`**). Nhóm `private` actor không có hàng nào **KHÔNG BAO GIỜ** xuất
   *     hiện — kể cả tên. ⚠️ Viếc `pending` cũng thấy là CÓ CHỦ Ý: sau `035` vào một nhóm kín, người
   *     xin vào phải thấy được yêu cầu đang chờ của CHÍNH MÌNH (`myStatus='pending'`) — họ đã biết
   *     nhóm tồn tại (`035` trả về DTO của nó), nên giấu đi chỉ làm FE không vẽ được nút «Đang chờ
   *     duyệt» chứ không giấu được gì. Đọc BÀI trong nhóm vẫn đòi `active` (việc của D3, không
   *     phải của câu này).
   *   • `membership='all'` + `manage:feed-group` → MỌI nhóm còn sống.
   *
   * ┌─ VÌ SAO NHÁNH `manage` CÓ MẶT Ở ĐÂY (quyết định thi công, plan §12 L-c) ───────────────────────┐
   * │ API-19 dòng 98 chỉ tả nhánh của NGƯỜI THƯỜNG. Nhưng `033`/`034`/`037`/`038`/`039` đều mở cho   │
   * │ `manage:feed-group` và `assertGroupVisibleTx` đã cho cờ đó NHÌN thấy nhóm `private`; nếu `030` │
   * │ giấu, người quản trị **hành động được nhưng không tìm được** — chỉ thao tác nổi khi đã biết id │
   * │ từ một đường khác. Đó là cổng-lệch-cổng theo chiều ngược, và nó đẩy FE sang đoán id.           │
   * │ Cờ này KHÔNG nới `visiblePostCondition` (D9-ii): thấy NHÓM ≠ đọc được BÀI trong nhóm.          │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async listGroups(
    tx: TenantTx,
    actor: SocialGroupActor,
    query: ListFeedGroupsQueryDto,
  ): Promise<{ rows: FeedGroupRow[]; total: number }> {
    const mine = eq(feedGroupMembers.status, "active");
    const scope: SQL =
      query.membership === "mine"
        ? mine
        : actor.canManageGroups
          ? // Tường minh `true`: người đọc thấy ngay "nhánh này CỐ Ý không lọc", khác hẳn một
            // điều kiện bị bỏ quên.
            sql`true`
          : (or(
              eq(feedGroups.visibility, "public"),
              // HÀNG membership của actor có tồn tại (LEFT JOIN khớp) — bất kể `active` hay `pending`.
              sql`${feedGroupMembers.userId} IS NOT NULL`,
            ) as SQL);

    const where = and(
      eq(feedGroups.companyId, actor.companyId),
      isNull(feedGroups.deletedAt),
      scope,
      query.q ? nameContains(query.q) : undefined,
    );

    // `count()` phải đi qua CÙNG LEFT JOIN: `mine` là vị từ trên bảng đã join, bỏ join ở câu đếm là
    // tổng số nói một đằng, trang liệt một nẻo.
    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedGroups)
      .leftJoin(feedGroupMembers, this.myMembershipOn(actor.actorUserId))
      .where(where);

    const rows = await tx
      .select({
        id: feedGroups.id,
        name: feedGroups.name,
        description: feedGroups.description,
        visibility: feedGroups.visibility,
        memberCount: feedGroups.memberCount,
        createdAt: feedGroups.createdAt,
        myRole: feedGroupMembers.role,
        myStatus: feedGroupMembers.status,
      })
      .from(feedGroups)
      .leftJoin(feedGroupMembers, this.myMembershipOn(actor.actorUserId))
      .where(where)
      // Thứ tự ỔN ĐỊNH cho OFFSET: tên rồi `id`. Thiếu vế thứ hai thì hai nhóm trùng tên (khác
      // tenant-scope hoa/thường) đổi chỗ được giữa hai lần lật trang ⇒ một nhóm hiện hai lần.
      .orderBy(asc(feedGroups.name), asc(feedGroups.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return { rows: rows as FeedGroupRow[], total: Number(totalRow?.n ?? 0) };
  }

  /**
   * `SOCIAL-API-032`/`033` — một nhóm còn sống + quan hệ của CHÍNH actor với nó.
   *
   * ⚠️ Đây KHÔNG phải cổng quyền: caller phải đi qua `assertGroupVisibleTx` (404 `ERR-012`) TRƯỚC.
   * Hàm này chỉ dựng hàng cho DTO — nó trả nhóm `private` cho bất kỳ ai hỏi đúng id.
   */
  async getGroupTx(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
    groupId: string,
  ): Promise<FeedGroupRow | null> {
    const [row] = await tx
      .select({
        id: feedGroups.id,
        name: feedGroups.name,
        description: feedGroups.description,
        visibility: feedGroups.visibility,
        memberCount: feedGroups.memberCount,
        createdAt: feedGroups.createdAt,
        myRole: feedGroupMembers.role,
        myStatus: feedGroupMembers.status,
      })
      .from(feedGroups)
      .leftJoin(feedGroupMembers, this.myMembershipOn(actorUserId))
      .where(
        and(
          eq(feedGroups.companyId, companyId),
          eq(feedGroups.id, groupId),
          isNull(feedGroups.deletedAt),
        ),
      )
      .limit(1);
    return (row as FeedGroupRow | undefined) ?? null;
  }

  /**
   * Nhóm CÒN SỐNG trong tenant — cổng của `035` xin vào và `036` rời nhóm, **cố ý KHÔNG hỏi
   * visibility**.
   *
   * ┌─ 🔴 VÌ SAO HAI ROUTE NÀY KHÔNG DÙNG `assertGroupVisibleTx` ───────────────────────────────────┐
   * │ `assertGroupVisibleTx` trả 404 cho «nhóm `private` + không phải thành viên `active`». Dùng nó  │
   * │ ở đây sẽ giết CHÍNH nhánh mà SPEC đòi:                                                         │
   * │   • `035`: "private ⇒ `pending`" (API-19 dòng 103) chỉ chạy được khi NGƯỜI NGOÀI gọi được      │
   * │     route. Gác bằng cổng đọc ⇒ nhánh `pending` thành code chết, nhóm kín KHÔNG AI xin vào được.│
   * │   • `036`: người đang `pending` ở nhóm kín KHÔNG phải thành viên `active` ⇒ họ sẽ không HUỶ    │
   * │     được chính yêu cầu của mình (và bảng delta D10 có đúng dòng đó).                           │
   * │ Cái giá: ai biết ĐÚNG UUID của một nhóm kín thì phân biệt được 404 với 201 — tức xác nhận nhóm │
   * │ đó tồn tại. Không lộ tên/mô tả/thành viên/bài, và UUIDv4 không đoán được. Đổi lại, `030` vẫn    │
   * │ giấu hoàn toàn nhóm kín (G10) nên không có đường nào LIỆT ra để dò.                            │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async findLiveGroupTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
  ): Promise<{ id: string; name: string; visibility: "public" | "private" } | null> {
    const [row] = await tx
      .select({ id: feedGroups.id, name: feedGroups.name, visibility: feedGroups.visibility })
      .from(feedGroups)
      .where(
        and(
          eq(feedGroups.companyId, companyId),
          eq(feedGroups.id, groupId),
          isNull(feedGroups.deletedAt),
        ),
      )
      .limit(1);
    return row ? { id: row.id, name: row.name, visibility: row.visibility } : null;
  }

  /**
   * `SOCIAL-API-031` — tạo nhóm. CHỈ hàng `feed_groups`; hàng `owner`/`active` và `member_count`
   * do service ghi trong CÙNG tx (một chỗ duy nhất biết bảng delta D10).
   *
   * ⚠️ Ném `23505` khi trùng tên (partial unique `feed_groups_company_name_uq`, chỉ tính nhóm còn
   * sống). Service dịch theo TÊN CONSTRAINT → 409 `GROUP_NAME_TAKEN`; ở đây KHÔNG nuốt.
   */
  async createGroupTx(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
    data: { name: string; description?: string | null; visibility: "public" | "private" },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(feedGroups)
      .values({
        companyId,
        name: data.name,
        description: data.description ?? null,
        visibility: data.visibility,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: feedGroups.id });
    return { id: row.id };
  }

  /**
   * `SOCIAL-API-033` — sửa nhóm.
   *
   * @returns `false` khi không hàng nào khớp (nhóm vừa bị xoá mềm giữa chừng) — caller dịch thành
   *   404, KHÔNG coi là thành công rỗng.
   */
  async updateGroupTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    actorUserId: string,
    patch: { name?: string; description?: string | null; visibility?: "public" | "private" },
  ): Promise<boolean> {
    const updated = await tx
      .update(feedGroups)
      .set({
        // `patch` đã qua `.strict()` + `refine(≥1 khoá)` ở contracts; chỉ khoá CÓ MẶT mới vào SET.
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(
        and(
          eq(feedGroups.companyId, companyId),
          eq(feedGroups.id, groupId),
          isNull(feedGroups.deletedAt),
        ),
      )
      .returning({ id: feedGroups.id });
    return updated.length > 0;
  }

  /**
   * `SOCIAL-API-034` — xoá MỀM nhóm.
   *
   * Hàng `feed_group_members` **GIỮ NGUYÊN** có chủ ý: mọi vị từ audience/hiển thị đều JOIN
   * `feed_groups` với `deleted_at IS NULL` (D13), nên nhóm chết là biến khỏi mọi đường đọc/ghi mà
   * không phải xoá cứng danh sách thành viên — xoá cứng ở đây là mất dữ liệu không khôi phục được
   * cho một thao tác vốn đảo ngược được.
   *
   * @returns `false` khi nhóm đã bị xoá trước đó (gọi lại là no-op, caller dịch thành 404).
   */
  async softDeleteGroupTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    actorUserId: string,
  ): Promise<boolean> {
    const now = new Date();
    const deleted = await tx
      .update(feedGroups)
      .set({ deletedAt: now, deletedBy: actorUserId, updatedAt: now, updatedBy: actorUserId })
      .where(
        and(
          eq(feedGroups.companyId, companyId),
          eq(feedGroups.id, groupId),
          isNull(feedGroups.deletedAt),
        ),
      )
      .returning({ id: feedGroups.id });
    return deleted.length > 0;
  }

  /**
   * Điều kiện LEFT JOIN "hàng membership của CHÍNH actor" — dùng chung cho `030` và `032`.
   *
   * Ba vế, thiếu vế nào cũng sai: `company_id` (tenant) · `group_id` (đúng nhóm của hàng ngoài) ·
   * `user_id` (đúng actor). Thiếu vế cuối thì mỗi nhóm nhân bản theo SỐ THÀNH VIÊN và `myRole` là
   * vai của một người bất kỳ.
   */
  private myMembershipOn(actorUserId: string): SQL {
    return and(
      eq(feedGroupMembers.companyId, feedGroups.companyId),
      eq(feedGroupMembers.groupId, feedGroups.id),
      eq(feedGroupMembers.userId, actorUserId),
    ) as SQL;
  }
}

/** Hàng nhóm cho DTO `030`/`032` — `myRole`/`myStatus` là quan hệ của CHÍNH actor (null = không có). */
export interface FeedGroupRow {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  memberCount: number;
  createdAt: Date;
  myRole: FeedGroupRole | null;
  myStatus: string | null;
}

/**
 * Vị từ tìm theo tên, không phân biệt hoa/thường.
 *
 * ⚠️ `%` và `_` trong chuỗi người dùng gõ được ESCAPE: không escape thì gõ `%` là quét toàn bảng
 * (vô hại ở đây) nhưng `_` lại âm thầm khớp một ký tự bất kỳ — kết quả tìm kiếm sai mà không ai báo.
 */
function nameContains(q: string): SQL {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${feedGroups.name} ILIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

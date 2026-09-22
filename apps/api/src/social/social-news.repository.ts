import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedPostAcks, feedPosts } from "../db/schema/social";
import { users } from "../db/schema/users";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1B — truy vấn `feed_post_acks` (`SOCIAL-API-020..022`). Tập cột TƯỜNG MINH, cấm
 * `select()` trần (DB-17 §11 R6).
 *
 * ⚠️ `feed_post_acks` là sổ **APPEND-ONLY** (DB-17 §6.9, app role CHỈ `SELECT`+`INSERT`): xác nhận đã
 * đọc là vết KHÔNG rút lại được. File này vì vậy không có method xoá, và sẽ không bao giờ có —
 * `UPDATE`/`DELETE` ở đây nổ ở tầng GRANT chứ không ở tầng code.
 */
@Injectable()
export class SocialNewsRepository {
  /**
   * Ghi xác nhận đã đọc. PK tổ hợp `(company_id, post_id, user_id)` + `ON CONFLICT DO NOTHING` ⇒
   * idempotent Ở TẦNG DB: bấm lại không tạo hàng trùng.
   *
   * @returns `{ firstTime }` — `false` khi người này đã xác nhận từ trước. Caller vẫn trả 200: đường
   *   GỠ/lặp không chặt như đường ghi mới, và một 409 ở đây chỉ làm FE phải xử lý thêm một nhánh cho
   *   cùng một kết quả cuối («đã xác nhận»).
   */
  async ackPost(
    tx: TenantTx,
    companyId: string,
    postId: string,
    userId: string,
  ): Promise<{ firstTime: boolean; ackedAt: Date }> {
    const inserted = await tx
      .insert(feedPostAcks)
      .values({ companyId, postId, userId })
      .onConflictDoNothing()
      .returning({ ackedAt: feedPostAcks.ackedAt });

    const fresh = inserted[0];
    if (fresh) return { firstTime: true, ackedAt: fresh.ackedAt };

    // Đã có hàng ⇒ đọc lại mốc CŨ. KHÔNG trả `new Date()`: mốc phải là lúc người đó THẬT SỰ xác nhận,
    // không phải lúc họ bấm lại — đây là sổ append-only phục vụ đối soát.
    const [existing] = await tx
      .select({ ackedAt: feedPostAcks.ackedAt })
      .from(feedPostAcks)
      .where(
        and(
          eq(feedPostAcks.companyId, companyId),
          eq(feedPostAcks.postId, postId),
          eq(feedPostAcks.userId, userId),
        ),
      )
      .limit(1);
    if (!existing) {
      // Không thể xảy ra trong cùng tx (ON CONFLICT vừa nói là có hàng). Ném thay vì bịa một mốc.
      throw new Error(
        "SocialNewsRepository.ackPost: ON CONFLICT nhưng không đọc lại được hàng ack",
      );
    }
    return { firstTime: false, ackedAt: existing.ackedAt };
  }

  /** `postId → true` cho một LÔ bài — MỘT truy vấn cho cả trang (khuôn `savedPostIds`, chống N+1). */
  async ackedPostIds(
    tx: TenantTx,
    companyId: string,
    userId: string,
    postIds: readonly string[],
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    const rows = await tx
      .select({ postId: feedPostAcks.postId })
      .from(feedPostAcks)
      .where(
        and(
          eq(feedPostAcks.companyId, companyId),
          eq(feedPostAcks.userId, userId),
          inArray(feedPostAcks.postId, [...postIds]),
        ),
      );
    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Số tin `requires_ack` mà actor CHƯA xác nhận — nguồn của widget `SOCIAL-WIDGET-002`.
   *
   * Đếm TRONG SQL trên CHÍNH vị từ visibility của actor: lấy về rồi đếm bằng JS sẽ đếm cả tin actor
   * không được thấy.
   */
  async countUnackedFor(tx: TenantTx, viewer: SocialViewerContext, visible: SQL): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.companyId, viewer.companyId),
          eq(feedPosts.type, "news"),
          eq(feedPosts.requiresAck, true),
          visible,
          sql`NOT EXISTS (
            SELECT 1 FROM ${feedPostAcks} a
             WHERE a.company_id = ${viewer.companyId}
               AND a.post_id = ${feedPosts.id}
               AND a.user_id = ${viewer.actorUserId}
          )`,
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * `SOCIAL-API-022` nửa «ĐÃ đọc» — ai đã xác nhận, kèm mốc. Phân trang OFFSET.
   *
   * ⚠️ Người gọi PHẢI đã đi qua `assertPostVisible` + cặp `manage:feed-news` (tầng 1 của route `022`):
   * đây là một ĐIỂM CHIẾU DANH TÍNH (tên + avatar), không phải một danh sách id.
   */
  async ackedPeople(
    tx: TenantTx,
    companyId: string,
    postId: string,
    opts: { page: number; limit: number },
  ): Promise<{ rows: AckPersonRow[]; total: number }> {
    const where = and(eq(feedPostAcks.companyId, companyId), eq(feedPostAcks.postId, postId));

    const [totalRow] = await tx.select({ n: count() }).from(feedPostAcks).where(where);

    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        fullName: users.fullName,
        avatarUrl: employeeProfiles.avatarUrl,
        ackedAt: feedPostAcks.ackedAt,
      })
      .from(feedPostAcks)
      .leftJoin(
        users,
        and(eq(users.id, feedPostAcks.userId), eq(users.companyId, feedPostAcks.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.userId, feedPostAcks.userId),
          eq(employeeProfiles.companyId, feedPostAcks.companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(where)
      // Thứ tự ỔN ĐỊNH cho OFFSET: mốc xác nhận rồi `user_id`. Thiếu vế thứ hai thì hai người xác
      // nhận cùng mili-giây đổi chỗ được giữa hai lần lật trang ⇒ một người hiện hai lần.
      .orderBy(asc(feedPostAcks.ackedAt), asc(feedPostAcks.userId))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    return { rows: rows as AckPersonRow[], total: Number(totalRow?.n ?? 0) };
  }

  /**
   * `SOCIAL-API-022` nửa «CHƯA đọc» — nhân viên thuộc audience của bài mà CHƯA có hàng `feed_post_acks`.
   *
   * 🔴 **ĐIỂM CHIẾU DANH TÍNH RỘNG NHẤT CỦA MODULE** (plan M15, bản đầu bỏ sót route này). Nửa «đã
   * đọc» chỉ chiếu người ĐÃ tương tác; nửa này chiếu tên + avatar của **MỌI người trong audience**,
   * kể cả người chưa làm gì. Vì vậy `022` gate bằng `manage:feed-news`, KHÔNG `view:feed`.
   *
   * ┌─ ĐỊNH NGHĨA "THUỘC AUDIENCE" — VÀ NỢ ĐÃ GHI ───────────────────────────────────────────────────┐
   * │ Ở đây = **nhân viên đang hoạt động có tài khoản**, lọc theo `org_unit_id` của bài khi            │
   * │ `audience='org_unit'`. Plan §3 viết "có `view:feed` hiệu lực" — KHÔNG thực hiện được ở tầng SQL: │
   * │ quyết định đó thuộc `PermissionService` (4 tầng ưu tiên · DENY-overrides · `expires_at` ·        │
   * │ wildcard · ảnh chụp catalog) và nó CHỈ trả lời cho MỘT user mỗi lượt. Hai đường khả dĩ đều tệ    │
   * │ hơn: hỏi engine cho TOÀN BỘ nhân viên công ty (N round-trip mỗi lần mở màn hình), hoặc viết lại  │
   * │ engine bằng SQL (nguồn sự thật thứ hai cho phân quyền — thứ codebase này cấm ở nhiều chỗ).       │
   * │ ĐO THẬT: seed `0578` cấp `view:feed` cho CẢ BỐN vai canonical ⇒ hai tập TRÙNG NHAU hôm nay.      │
   * │ ⚠️ NỢ `S16-SOCIAL-BE-2`: khi tenant admin bắt đầu cấp quyền feed cho vai TUỲ BIẾN, một nhân viên │
   * │ không có `view:feed` sẽ vẫn hiện trong danh sách «chưa đọc». Cần một API "ai có cặp X" set-based │
   * │ ở tầng permission (không phải ở SOCIAL) để đóng đúng chỗ.                                        │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `audience='group'` KHÔNG mở ở BE-1/BE-1B (không route quản lý nhóm) ⇒ trả RỖNG, fail-closed:
   * "coi như cả công ty" sẽ chiếu danh bạ toàn công ty cho một bài đáng lẽ riêng tư.
   */
  async unackedEmployeesFor(
    tx: TenantTx,
    companyId: string,
    post: { id: string; audience: string; orgUnitId: string | null },
    opts: { page: number; limit: number },
  ): Promise<{ rows: AckPersonRow[]; total: number }> {
    if (post.audience === "group") return { rows: [], total: 0 };
    if (post.audience === "org_unit" && post.orgUnitId == null) return { rows: [], total: 0 };

    const where = and(
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
      // 🔴 «đang hoạt động» = `status='active'`, KHÔNG phải `deleted_at IS NULL`: off-board đặt
      // `resigned`/`terminated` và GIỮ NGUYÊN hàng (`hr-write.service.ts:600-667`). Thiếu vế này,
      // nửa «chưa đọc» liệt người đã nghỉ VĨNH VIỄN — họ không thể `ack` — nên tỉ lệ đọc tin bắt
      // buộc không bao giờ về 0 và người quản lý không phân biệt được ai còn làm việc.
      eq(employeeProfiles.status, "active"),
      sql`${employeeProfiles.userId} IS NOT NULL`,
      ...(post.audience === "org_unit" && post.orgUnitId != null
        ? [eq(employeeProfiles.orgUnitId, post.orgUnitId)]
        : []),
      sql`NOT EXISTS (
        SELECT 1 FROM ${feedPostAcks} a
         WHERE a.company_id = ${companyId}
           AND a.post_id = ${post.id}
           AND a.user_id = ${employeeProfiles.userId}
      )`,
    );

    const [totalRow] = await tx.select({ n: count() }).from(employeeProfiles).where(where);

    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        fullName: users.fullName,
        avatarUrl: employeeProfiles.avatarUrl,
        // Nửa «chưa đọc» KHÔNG có mốc — `null` là câu trả lời đúng, không phải dữ liệu thiếu.
        ackedAt: sql<Date | null>`NULL::timestamptz`,
      })
      .from(employeeProfiles)
      // Liveness của tài khoản ở điều kiện JOIN (không ở `where`): `where` dùng CHUNG với câu đếm,
      // và hai câu phải đo CÙNG một tập. Khuôn `social-mentions.ts:195-201`.
      .leftJoin(
        users,
        and(
          eq(users.id, employeeProfiles.userId),
          eq(users.companyId, employeeProfiles.companyId),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      )
      .where(where)
      .orderBy(asc(employeeProfiles.id))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    return { rows: rows as AckPersonRow[], total: Number(totalRow?.n ?? 0) };
  }

  /**
   * Người nhận `NOTI-031` — user thuộc audience của tin, ĐÃ SẮP XẾP tăng dần theo `user_id`,
   * **đã cắt ở `limit` TRONG SQL** và kèm `total` (tổng THẬT trước khi cắt).
   *
   * ⚠️ Sắp xếp là một phần của HỢP ĐỒNG, không phải trang trí: caller cắt ở trần
   * `SOCIAL_NEWS_NOTI_RECIPIENT_CAP`, và cắt theo thứ tự ngẫu nhiên của planner thì không tái lập
   * được — ca test flaky, sự cố thật không truy được ai bị bỏ.
   *
   * ⟲ **Cắt ở SQL, không ở JS** (gate 22/09): bản đầu `SELECT` MỌI user của audience rồi `.slice()`
   * ở Node — với công ty 5 000 người là 5 000 uuid qua dây để dùng 500. Đúng lớp
   * `clamp-must-be-sql-not-js`. `total` phải là câu `count()` RIÊNG: cắt rồi thì `rows.length`
   * không còn là tổng, và `totalRecipients` trong payload sẽ NÓI DỐI đúng lúc nó có việc để làm.
   *
   * `excludeUserId` (tác giả tin) cũng lọc TRONG SQL: lọc ở JS sau khi đã cắt làm tập trả về
   * `limit - 1` người khi tác giả rơi vào cửa sổ cắt.
   *
   * «thuộc audience» = nhân viên **đang hoạt động** (`status='active'`, xem `unackedEmployeesFor`)
   * có tài khoản. Nợ CHƯA đóng (chuyển `S16-SOCIAL-BE-2`): chưa lọc theo `view:feed` hiệu lực.
   */
  async audienceUserIds(
    tx: TenantTx,
    companyId: string,
    post: { audience: string; orgUnitId: string | null },
    opts: { excludeUserId: string; limit: number },
  ): Promise<{ userIds: string[]; total: number }> {
    if (post.audience === "group") return { userIds: [], total: 0 };
    if (post.audience === "org_unit" && post.orgUnitId == null) return { userIds: [], total: 0 };

    const where = and(
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
      // Cùng vị từ «đang hoạt động» với `unackedEmployeesFor` — hai đường PHẢI nói cùng một câu: một
      // bên liệt «chưa đọc», bên kia quyết ai được báo. Lệch nhau là người đã nghỉ chiếm suất trong
      // trần 500 và đẩy người ĐANG LÀM ra khỏi thông báo một cách tất định.
      eq(employeeProfiles.status, "active"),
      sql`${employeeProfiles.userId} IS NOT NULL`,
      sql`${employeeProfiles.userId} <> ${opts.excludeUserId}`,
      ...(post.audience === "org_unit" && post.orgUnitId != null
        ? [eq(employeeProfiles.orgUnitId, post.orgUnitId)]
        : []),
    );

    const [totalRow] = await tx.select({ n: count() }).from(employeeProfiles).where(where);

    const rows = await tx
      .select({ userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(where)
      .orderBy(asc(employeeProfiles.userId))
      .limit(opts.limit);

    return {
      userIds: rows.map((r) => r.userId).filter((id): id is string => id != null),
      total: Number(totalRow?.n ?? 0),
    };
  }
}

export interface AckPersonRow {
  employeeId: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  ackedAt: Date | null;
}

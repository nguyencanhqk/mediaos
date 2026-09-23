import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { ListFeedGroupMembersQueryDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedGroupMembers } from "../db/schema/social";
import { users } from "../db/schema/users";
import type { FeedGroupMemberState } from "./social-counters";
import type { FeedGroupRole } from "./social.types";

/**
 * S16-SOCIAL-BE-2A — truy vấn `feed_group_members` (`035`..`039`).
 *
 * ┌─ 🔴 MỌI CÂU GHI ĐỀU MANG VỊ TỪ TRẠNG THÁI TRONG `WHERE` ───────────────────────────────────────┐
 * │ `approveTx` đòi `status='pending'`, `setRoleTx` đòi `status='active'`, `deleteMemberTx` trả      │
 * │ đúng hàng NÓ vừa xoá. Không phải để "kiểm tra hai lần" — mà vì bộ đếm `member_count` suy TỪ      │
 * │ CHUYỂN TRẠNG THÁI (D10): đọc trạng thái ở câu TRƯỚC rồi ghi ở câu SAU là TOCTOU, và khi trạng    │
 * │ thái đã đổi giữa hai câu thì delta cộng vào là một con số SAI VĨNH VIỄN (không ai phát hiện ra   │
 * │ cho tới khi `chk_feed_groups_member_count` nổ ở một request khác, hoặc không bao giờ).           │
 * │ ⇒ Mỗi hàm trả về ĐÚNG những gì DB thật sự đã đổi; 0 hàng là một câu trả lời, không phải lỗi.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Rời nhóm / mời ra / từ chối yêu cầu = **DELETE CỨNG** có chủ ý (DB-17 §4.9). Vết nằm ở
 * `audit_logs` (`object_type='feed_group'`), KHÔNG có cột `status='removed'`.
 */
@Injectable()
export class SocialGroupMembersRepository {
  /**
   * Thêm một hàng thành viên. Dùng cho `031` (người tạo → `owner`/`active`) và `035` (xin vào).
   *
   * `employee_id` lấy bằng SUBQUERY trong CHÍNH câu INSERT — không round-trip thêm, và không để cột
   * đó rỗng vĩnh viễn ở một bảng mà DB-17 khai nó có nghĩa. `NULL` khi người này chưa có hồ sơ nhân
   * sự (tài khoản hệ thống): hợp lệ, cột nullable.
   *
   * ⚠️ Ném `23505` (`feed_group_members_pk`) khi hàng đã tồn tại — caller dịch → 409 `ERR-013`.
   * KHÔNG `ON CONFLICT DO NOTHING`: "đã là thành viên" là một câu trả lời người dùng cần nghe, nuốt
   * nó thành 201 là nói dối về trạng thái.
   */
  async insertMemberTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    userId: string,
    role: FeedGroupRole,
    status: "active" | "pending",
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO feed_group_members (company_id, group_id, user_id, employee_id, role, status, joined_at)
      VALUES (
        ${companyId}, ${groupId}, ${userId},
        (SELECT ep.id FROM employee_profiles ep
          WHERE ep.company_id = ${companyId} AND ep.user_id = ${userId}
            AND ep.deleted_at IS NULL
          LIMIT 1),
        ${role}, ${status},
        ${status === "active" ? sql`now()` : sql`NULL`}
      )
    `);
  }

  /**
   * `SOCIAL-API-037` — danh sách thành viên, phân trang OFFSET.
   *
   * 🔴 **D7 — `feed_group_members.status='active'` KHÔNG đồng nghĩa "người này còn làm việc".** Nghỉ
   * việc không xoá hàng thành viên (và không xoá mềm hồ sơ), nên nếu chỉ lọc theo `status` của hàng
   * thì người đã nghỉ vẫn nằm trong danh bạ nhóm. Hai INNER JOIN dưới đây là vế thứ hai của vị từ
   * "người đang hoạt động" (khuôn `social-mentions.ts`): `users` còn sống + `employee_profiles`
   * `status='active'`.
   *
   * ⚠️ `total` đi qua **cùng hai JOIN** — lệch một vế là "12 thành viên" đứng cạnh danh sách 10 dòng.
   * (Bộ đếm `member_count` của SPEC §13.6 lại đo tập KHÁC — không lọc nhân sự; `037.total` vì vậy
   * lấy từ câu đếm của CHÍNH nó, KHÔNG lấy `member_count`. Lệch có chủ ý, ghi ở plan M-c.)
   */
  async listMembersTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    query: ListFeedGroupMembersQueryDto,
  ): Promise<{ rows: FeedGroupMemberRow[]; total: number }> {
    const where = and(
      eq(feedGroupMembers.companyId, companyId),
      eq(feedGroupMembers.groupId, groupId),
      query.status ? eq(feedGroupMembers.status, query.status) : undefined,
    );

    const joinUsers = and(
      eq(users.id, feedGroupMembers.userId),
      eq(users.companyId, feedGroupMembers.companyId),
      isNull(users.deletedAt),
      eq(users.status, "active"),
    );
    const joinEmployees = and(
      eq(employeeProfiles.userId, feedGroupMembers.userId),
      eq(employeeProfiles.companyId, feedGroupMembers.companyId),
      eq(employeeProfiles.status, "active"),
      isNull(employeeProfiles.deletedAt),
    );

    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedGroupMembers)
      .innerJoin(users, joinUsers)
      .innerJoin(employeeProfiles, joinEmployees)
      .where(where);

    const rows = await tx
      .select({
        userId: feedGroupMembers.userId,
        employeeId: employeeProfiles.id,
        fullName: users.fullName,
        avatarUrl: employeeProfiles.avatarUrl,
        role: feedGroupMembers.role,
        status: feedGroupMembers.status,
        joinedAt: feedGroupMembers.joinedAt,
      })
      .from(feedGroupMembers)
      .innerJoin(users, joinUsers)
      .innerJoin(employeeProfiles, joinEmployees)
      .where(where)
      // Thứ tự ỔN ĐỊNH cho OFFSET (mốc tạo hàng rồi `user_id`) — xem cùng lý do ở `ackedPeople`.
      .orderBy(asc(feedGroupMembers.createdAt), asc(feedGroupMembers.userId))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return { rows: rows as FeedGroupMemberRow[], total: Number(totalRow?.n ?? 0) };
  }

  /**
   * `038` nhánh DUYỆT — `pending` → `active` (+ mốc tham gia).
   *
   * @returns `true` khi ĐÚNG hàng `pending` đó vừa đổi (⇒ delta `+1`); `false` khi không còn hàng
   *   `pending` nào khớp (ai đó vừa duyệt/từ chối trước) — caller trả 409, KHÔNG cộng đếm.
   */
  async approveTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await tx
      .update(feedGroupMembers)
      .set({ status: "active", joinedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(feedGroupMembers.companyId, companyId),
          eq(feedGroupMembers.groupId, groupId),
          eq(feedGroupMembers.userId, userId),
          eq(feedGroupMembers.status, "pending"),
        ),
      )
      .returning({ userId: feedGroupMembers.userId });
    return rows.length > 0;
  }

  /**
   * `038` nhánh ĐỔI VAI TRÒ — chỉ trên hàng `active`.
   *
   * Vế `status='active'` trong `WHERE` là thứ giữ cho `chk_feed_group_members_pending_role`
   * (`status='active' OR role='member'`) KHÔNG BAO GIỜ bị chạm: một hàng `pending` không thể nhận
   * `role='admin'` qua đường này, dù caller có gửi gì.
   */
  async setRoleTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    userId: string,
    role: FeedGroupRole,
  ): Promise<boolean> {
    const rows = await tx
      .update(feedGroupMembers)
      .set({ role, updatedAt: new Date() })
      .where(
        and(
          eq(feedGroupMembers.companyId, companyId),
          eq(feedGroupMembers.groupId, groupId),
          eq(feedGroupMembers.userId, userId),
          eq(feedGroupMembers.status, "active"),
        ),
      )
      .returning({ userId: feedGroupMembers.userId });
    return rows.length > 0;
  }

  /**
   * Xoá CỨNG một hàng thành viên — `036` rời nhóm · `038` từ chối yêu cầu · `039` mời ra.
   *
   * 🔴 **Delta của `member_count` suy TỪ HÀNG THẬT SỰ BỊ XOÁ**, không từ tên route: `RETURNING`
   * mang `status` của hàng đã mất. Huỷ một yêu cầu `pending` (qua `036`) hoặc mời ra một hàng
   * `pending` (qua `039`) là delta **0**; trừ nhầm `−1` ở đó là chạm `chk_feed_groups_member_count`
   * ⇒ 500, hoặc lệch âm hỏng câm.
   *
   * @returns trạng thái + vai trò của hàng vừa xoá, `null` khi không có hàng nào (không phải thành
   *   viên, hoặc ai đó vừa xoá trước).
   */
  async deleteMemberTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    userId: string,
  ): Promise<{ role: FeedGroupRole; status: FeedGroupMemberState } | null> {
    const rows = await tx
      .delete(feedGroupMembers)
      .where(
        and(
          eq(feedGroupMembers.companyId, companyId),
          eq(feedGroupMembers.groupId, groupId),
          eq(feedGroupMembers.userId, userId),
        ),
      )
      .returning({ role: feedGroupMembers.role, status: feedGroupMembers.status });
    const row = rows[0];
    return row
      ? { role: row.role as FeedGroupRole, status: row.status as FeedGroupMemberState }
      : null;
  }
}

/** Một hàng thành viên đã qua bộ lọc D7 — nguồn cho `FeedGroupMemberDto`. */
export interface FeedGroupMemberRow {
  userId: string;
  employeeId: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: FeedGroupRole;
  status: "active" | "pending";
  joinedAt: Date | null;
}

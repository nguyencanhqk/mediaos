import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { feedGroupMembers, feedGroups } from "../db/schema/social";
import { SOCIAL_ERR, socialError } from "./social.errors";
import type { FeedGroupRole, SocialGroupActor, SocialGroupMembership } from "./social.types";

/**
 * S16-SOCIAL-BE-2A — cổng QUYỀN TRONG NHÓM (vai trò là HÀNG, không phải grant).
 *
 * ┌─ 🔴 BA LUẬT BẤT DI BẤT DỊCH CỦA FILE NÀY ──────────────────────────────────────────────────────┐
 * │ 1. **CHỈ NHẬN `tx`, TUYỆT ĐỐI KHÔNG tự mở `withTenant`.** Mọi method ở đây chạy TRONG tx ghi của │
 * │    caller. `withTenant` lồng nhau = TREO IM LẶNG trên PgBouncer transaction-mode (pool `max:20`, │
 * │    không `connectionTimeoutMillis`): tx ngoài giữ connection, tx trong xin connection thứ hai,   │
 * │    cạn pool là cả tiến trình đứng — không lỗi, không log. Đã cắn thật ở BE-1B (hai hình dạng).   │
 * │ 2. **KHÔNG kiểm ở tx riêng rồi ghi sau** — đó là TOCTOU. Kiểm và ghi phải cùng MỘT tx.           │
 * │ 3. **Route GHI theo vai ĐỌC VAI SAU KHOÁ** — gọi `lockAndAssertGroupRoleTx`, KHÔNG gọi           │
 * │    `assertGroupRoleTx` rồi mới khoá. Cùng tx vẫn CHƯA đủ: dưới READ COMMITTED vai đọc TRƯỚC khoá │
 * │    có thể bị một `038`/`039` song song đổi lúc ta chờ khoá ⇒ người VỪA mất quyền vẫn ghi được    │
 * │    (S16-SOCIAL-GROUPTOCTOU-1 §2: `039` M3, `038` admin kiêm manage M6).                          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Khuôn: `tasks/project-access.service.ts` (`assertProjectRoleTx(..., allowedRoles)`) — tập vai trò
 * cho phép truyền THEO TỪNG LỜI GỌI, không phải một tập cứng dùng chung: `033` là `owner|admin` còn
 * **`034` là `owner` MỘT MÌNH** (API-19 §5.1 dòng 102 — admin KHÔNG được xoá nhóm). Một tập cứng là
 * cách chắc chắn nhất để admin xoá được nhóm mà không ai nhận ra.
 */
@Injectable()
export class SocialGroupAccessService {
  /**
   * Hàng membership của actor trong nhóm (kể cả `pending`), hoặc `null`.
   *
   * KHÔNG lọc `deleted_at` của nhóm ở đây: người gọi quyết định nhóm đã xoá mềm có nghĩa gì với
   * nghiệp vụ của họ (`assertGroupVisibleTx` loại, còn neo khoá của D6-ii thì KHÔNG — xem
   * `lockGroupRowTx`).
   */
  async getMembershipTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    userId: string,
  ): Promise<SocialGroupMembership | null> {
    const [row] = await tx
      .select({ role: feedGroupMembers.role, status: feedGroupMembers.status })
      .from(feedGroupMembers)
      .where(
        and(
          eq(feedGroupMembers.companyId, companyId),
          eq(feedGroupMembers.groupId, groupId),
          eq(feedGroupMembers.userId, userId),
        ),
      )
      .limit(1);
    return row ? { role: row.role as FeedGroupRole, status: row.status } : null;
  }

  /**
   * Cửa của MỌI đường theo `{group_id}`. MỘT truy vấn, MỘT thông điệp 404 cho MỌI lý do.
   *
   * @throws NotFoundException (404 `SOCIAL-ERR-012`) khi: nhóm không tồn tại · tenant khác · **đã xoá
   *   mềm (D13)** · `private` mà actor không phải thành viên `active`. Tất cả trả về BYTE GIỐNG HỆT
   *   NHAU — phân biệt được tức là xác nhận một nhóm kín có tồn tại.
   *
   * @returns hàng nhóm + membership của actor (null nếu actor chỉ đang xem một nhóm `public`).
   */
  async assertGroupVisibleTx(
    tx: TenantTx,
    actor: SocialGroupActor,
    groupId: string,
  ): Promise<{
    id: string;
    name: string;
    visibility: string;
    membership: SocialGroupMembership | null;
  }> {
    const [group] = await tx
      .select({
        id: feedGroups.id,
        name: feedGroups.name,
        visibility: feedGroups.visibility,
      })
      .from(feedGroups)
      .where(
        and(
          eq(feedGroups.companyId, actor.companyId),
          eq(feedGroups.id, groupId),
          isNull(feedGroups.deletedAt),
        ),
      )
      .limit(1);
    if (!group) throw new NotFoundException(socialError(SOCIAL_ERR.GROUP_NOT_FOUND));

    const membership = await this.getMembershipTx(tx, actor.companyId, groupId, actor.actorUserId);
    const isActiveMember = membership?.status === "active";
    // `manage:feed-group` NHÌN được mọi nhóm (để quản trị) — nhưng cờ này KHÔNG nới
    // `visiblePostCondition` (D9-ii): thấy NHÓM khác với đọc được BÀI trong nhóm.
    if (group.visibility === "private" && !isActiveMember && !actor.canManageGroups) {
      throw new NotFoundException(socialError(SOCIAL_ERR.GROUP_NOT_FOUND));
    }
    return { ...group, membership };
  }

  /**
   * 403 `SOCIAL-ERR-014` khi actor không phải thành viên `active` mang vai trò thuộc `allowedRoles`.
   *
   * ⚠️ Route GHI theo vai (`033`/`034`/`038`/`039`) KHÔNG gọi trần hàm này — gọi
   * `lockAndAssertGroupRoleTx` (luật 3: khoá hàng nhóm RỒI mới đọc vai). Gọi trần chỉ dành cho route
   * CHỈ ĐỌC (`037`), nơi không có gì để ghi bằng một vai đã cũ.
   *
   * @param allowedRoles tập vai trò CHO TỪNG ROUTE (`033`→`['owner','admin']`, **`034`→`['owner']`**,
   *   `037`→cả ba, `038`/`039`→`['owner','admin']`). KHÔNG có giá trị mặc định: quên truyền phải là
   *   lỗi biên dịch, không phải một tập rộng im lặng.
   * @returns `viaManage: true` khi actor đi qua nhánh thoát `manage:feed-group` trên nhóm KHÔNG phải
   *   của mình — caller dùng nó để quyết định ghi `audit_logs` (API-19 §8: chỉ thao tác lên nội dung
   *   người khác mới vào sổ).
   */
  async assertGroupRoleTx(
    tx: TenantTx,
    actor: SocialGroupActor,
    groupId: string,
    allowedRoles: readonly FeedGroupRole[],
  ): Promise<{ membership: SocialGroupMembership | null; viaManage: boolean }> {
    const membership = await this.getMembershipTx(tx, actor.companyId, groupId, actor.actorUserId);
    const hasRole =
      membership != null &&
      membership.status === "active" &&
      allowedRoles.includes(membership.role);
    if (hasRole) return { membership, viaManage: false };
    if (actor.canManageGroups) return { membership, viaManage: true };
    throw new ForbiddenException(socialError(SOCIAL_ERR.GROUP_ROLE_REQUIRED));
  }

  /**
   * 🔴 NEO CHỐNG ĐUA của bất biến "≥1 owner active" (D6-ii). Gọi **TRƯỚC** mọi câu đếm owner, trong
   * CÙNG tx với thao tác ghi.
   *
   * ┌─ VÌ SAO `COUNT` TRẦN KHÔNG ĐỦ (plan-reviewer vòng 2, C3) ──────────────────────────────────────┐
   * │ Dưới READ COMMITTED, hai tx cùng gọi `036` (hai owner khác nhau cùng rời) đều đọc `count = 2`,  │
   * │ đều đi qua cổng, rồi mỗi tx xoá **một hàng KHÁC nhau** ⇒ không đụng khoá hàng nào ⇒ cả hai      │
   * │ commit ⇒ nhóm còn **0 owner và khoá vĩnh viễn** (chỉ `manage:feed-group` gỡ được). Mọi ca test   │
   * │ TUẦN TỰ (G5/G5b/G5c) vẫn xanh trong khi bất biến đã vỡ. Serialize bằng cách bắt mọi đường mất   │
   * │ owner đi qua MỘT hàng chung: hàng `feed_groups` của chính nhóm đó.                              │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **CỐ Ý KHÔNG lọc `deleted_at IS NULL`** — miễn trừ DUY NHẤT của luật D13 (W4). Neo phải khoá
   * được cả nhóm vừa bị xoá mềm; thêm vế đó vào là mở lại cửa đua đúng lúc nhóm đang bị xoá.
   *
   * @throws NotFoundException (404 `SOCIAL-ERR-012`) khi câu khoá khớp 0 hàng (S16-SOCIAL-GROUPTOCTOU-1,
   *   FULL gate lượt 1). Hôm nay không tới được — mọi caller đã thấy nhóm còn sống, `company_id` bất
   *   biến, không xoá cứng. Nhưng một policy RLS tách riêng cho UPDATE (PG áp `USING` của nó lên
   *   `SELECT … FOR UPDATE`) hay `companyId` lệch sẽ biến neo thành khoá RỖNG: «đọc vai SAU khoá» chỉ
   *   còn là tên gọi, TOCTOU trở lại mà không lỗi, không log. Đếm theo hàng TỒN TẠI, không theo
   *   `deleted_at` ⇒ miễn trừ W4 giữ nguyên.
   */
  async lockGroupRowTx(tx: TenantTx, companyId: string, groupId: string): Promise<void> {
    const locked = await tx.execute(
      sql`SELECT 1 FROM ${feedGroups}
           WHERE company_id = ${companyId} AND id = ${groupId}
           FOR UPDATE`,
    );
    if (locked.rows.length !== 1) {
      throw new NotFoundException(socialError(SOCIAL_ERR.GROUP_NOT_FOUND));
    }
  }

  /**
   * 🔴 Cổng vai của MỌI route GHI theo vai nhóm (`033`/`034`/`038`/`039`) — luật 3 ở đầu file: KHOÁ hàng
   * `feed_groups` (`lockGroupRowTx`) RỒI MỚI đọc vai actor (`assertGroupRoleTx`). MỘT lượt đọc, SAU khoá.
   *
   * Vì sao (S16-SOCIAL-GROUPTOCTOU-1, đo plan §2): vai là HÀNG, không phải grant. Một `038` song song
   * (khoá nhóm → hạ vai actor → commit) chen giữa «đọc vai» và «khoá» ⇒ actor VỪA mất quyền vẫn ghi
   * bằng vai CŨ — `039` mời người khác ra (M3), `034` xoá mềm nhóm (M9), `033` đổi nhóm kín thành công
   * khai (M10). Đọc SAU khoá thì mọi đường đổi vai đã serialize qua đúng hàng nhóm này. Cũng KHÔNG
   * «đọc trước + đọc lại sau khoá rồi đối chiếu»: hai lượt đọc cho hai câu trả lời, và chính chỗ đối
   * chiếu sinh 403 oan cho admin kiêm manage (M6) cùng audit sai nguồn quyền (M8).
   *
   * Luật quyền KHÔNG đổi: vai hàng ∈ `allowedRoles` HOẶC `manage:feed-group` «BẤT KỂ vai trong nhóm»
   * (API-19 §5.1 dòng 107), đánh giá trên hàng đọc SAU khoá (owner ký D1=(a) 02/10/2026). Hàng của actor
   * biến mất giữa chừng ⇒ 403 `ERR-014`, không 404 (D3=(a)): actor đã qua cổng 404 lúc request bắt đầu.
   *
   * ⚠️ Gọi SAU `assertGroupVisibleTx` (404 TRƯỚC 403): người ngoài nhóm kín không bao giờ chạm khoá
   * (lưới: U3 thứ tự cổng + ca O-x/P-x của `social-grouptoctou-race.int-spec.ts`).
   *
   * ⚠️ Dựa vào READ COMMITTED (mặc định của `withTenant`, đo M1): mỗi câu một snapshot MỚI nên câu đọc
   * vai sau khoá thấy thay đổi tx giữ khoá đã commit. Dưới REPEATABLE READ nó dùng lại snapshot TRƯỚC
   * khoá — vai cũ, không 40001 vì tx giữ khoá chỉ khoá hàng nhóm (D-1 sẽ đỏ).
   *
   * @returns `{ membership, viaManage }` của lượt đọc SAU khoá — `viaManage` là nguồn quyền LÚC COMMIT,
   *   caller ghi đúng giá trị này vào `audit_logs`.
   */
  async lockAndAssertGroupRoleTx(
    tx: TenantTx,
    actor: SocialGroupActor,
    groupId: string,
    allowedRoles: readonly FeedGroupRole[],
  ): Promise<{ membership: SocialGroupMembership | null; viaManage: boolean }> {
    await this.lockGroupRowTx(tx, actor.companyId, groupId);
    return this.assertGroupRoleTx(tx, actor, groupId, allowedRoles);
  }

  /**
   * 409 `SOCIAL-ERR-015` khi thao tác sẽ lấy đi owner `active` CUỐI CÙNG.
   *
   * @param losingUserId người sắp mất vai trò `owner` (rời nhóm `036` · bị hạ vai trò `038` · bị mời
   *   ra `039`). Đếm owner `active` **KHÁC** người đó: đếm cả họ rồi so `> 1` là cùng một phép tính
   *   nhưng đọc sai khi hàng của họ không phải `owner` (không ai mất gì, vẫn bị chặn).
   *
   * ⚠️ PHẢI gọi SAU `lockGroupRowTx` trong cùng tx. Gọi mà không khoá = C3 nguyên vẹn.
   */
  async assertOwnerRemainsTx(
    tx: TenantTx,
    companyId: string,
    groupId: string,
    losingUserId: string,
  ): Promise<void> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(feedGroupMembers)
      .where(
        and(
          eq(feedGroupMembers.companyId, companyId),
          eq(feedGroupMembers.groupId, groupId),
          eq(feedGroupMembers.role, "owner"),
          eq(feedGroupMembers.status, "active"),
          ne(feedGroupMembers.userId, losingUserId),
        ),
      );
    if ((row?.n ?? 0) < 1) throw new ConflictException(socialError(SOCIAL_ERR.GROUP_LAST_OWNER));
  }
}

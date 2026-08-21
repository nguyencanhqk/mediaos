import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { SecurityEventSortField, AuthLogSortOrder } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { userSecurityEvents } from "../db/schema/auth-logs";
import { users } from "../db/schema/users";
import {
  identityColumns,
  rowScopeSql,
  type IdentityGrant,
} from "../permission/identity-projection";

/**
 * S6-SEC-IDENTITY-PROJ-1 (KI-054) — alias `users` cho vai NGƯỜI GÂY RA sự kiện, nâng lên cấp module.
 *
 * Trước bản vá nó là biến cục bộ trong `findManyTx`. Phải export vì `AuthLogsViewerService` cần chính
 * hai cột `id`/`company_id` CỦA ALIAS NÀY để dựng vị từ scope cho vai actor — nếu service dựng vị từ
 * trên `users` gốc thì nó đang nói về CHỦ THỂ, và cả hai chiều đều sai (xem chú thích trong findManyTx).
 */
export const SECURITY_EVENT_ACTOR = alias(users, "sec_event_actor");

/**
 * Bộ lọc security-event (mọi field optional). KHÔNG nhận company_id — withTenant + RLS ép Company-scope
 * (BẤT BIẾN #1). event_type tự do (PASSWORD_CHANGED/USER_LOCKED…) → eq exact theo chuỗi đã validate.
 *
 * ⚠️ Mọi field ở đây đến TỪ QUERY PARAM CỦA CALLER — xem chú thích cùng chỗ ở `login-log.repository`.
 */
export interface SecurityEventFilter {
  userId?: string;
  eventType?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  dateFrom?: Date;
  dateTo?: Date;
}

/** Phân trang + sắp xếp (đã qua allowlist contract ở tầng DTO). */
export interface SecurityEventPage {
  sort: SecurityEventSortField;
  order: AuthLogSortOrder;
  limit: number;
  offset: number;
}

/**
 * BA grant cho MỘT truy vấn, truyền BẰNG TÊN (S10-SEC-AUDITLOGROW-1, plan-review vòng 1).
 *
 * Ba giá trị cùng kiểu `IdentityGrant` phân biệt nhau chỉ bằng vị trí thì hoán vị là HỢP KIỂU, và
 * đối chiếu bảng bên trong `rowScopeSql`/`identityColumns` chỉ nổ ở lần CHẠY truy vấn đầu tiên —
 * không ở typecheck. Đặt tên biến chúng thành lỗi biên dịch.
 *
 *   • `rowScope`         → cặp `view:audit-log`, chặn TẬP HÀNG trên `user_security_events.user_id`
 *   • `identitySubject`  → cặp `view:user`, che CỘT danh tính của CHỦ THỂ (`users`)
 *   • `identityActor`    → cặp `view:user`, che CỘT danh tính của NGƯỜI GÂY RA (`sec_event_actor`)
 */
export interface SecurityEventGrants {
  rowScope: IdentityGrant;
  identitySubject: IdentityGrant;
  identityActor: IdentityGrant;
}

/** 1 hàng security-event + ref user (subject) + ref actor (null = hệ thống). */
export interface SecurityEventRow {
  id: string;
  eventType: string;
  severity: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  userId: string | null;
  /** Cờ scope của vai CHỦ THỂ. Repo trả, service tiêu thụ — KHÔNG được lọt ra DTO. */
  identityInScope: boolean;
  userEmail: string | null;
  userFullName: string | null;
  actorUserId: string | null;
  /** Cờ scope của vai NGƯỜI GÂY RA — tên RIÊNG, nếu trùng `identityInScope` thì nó đè cờ trên. */
  actorIdentityInScope: boolean;
  actorEmail: string | null;
  actorFullName: string | null;
}

/**
 * Bản đồ khoá-sort (API) → CỘT drizzle. NGUỒN DUY NHẤT, dùng chung với ratchet — xem docblock cùng
 * tên ở `login-log.repository.ts` để biết vì sao KHÔNG được giữ hai bản.
 */
export const SECURITY_EVENT_SORT_COLUMN: Record<SecurityEventSortField, PgColumn> = {
  created_at: userSecurityEvents.createdAt,
  severity: userSecurityEvents.severity,
  event_type: userSecurityEvents.eventType,
};

/**
 * SecurityEventRepository — đọc append-only `user_security_events`. `tx` từ withTenant (RLS sống). Chỉ
 * SELECT/COUNT (append-only BẤT BIẾN #2). KHÔNG select cột jsonb `payload` (có thể chứa secret → BẤT BIẾN
 * #3). 2 leftJoin users: subject (user_id) + actor (actor_user_id, alias tách bảng).
 */
@Injectable()
export class SecurityEventRepository {
  /**
   * S10-SEC-AUDITLOGROW-1 (KI-070) — `rowScope` đứng TRƯỚC filter và không bỏ được. Xem docblock
   * cùng tên ở `login-log.repository.ts`.
   *
   * ⚠️ Vị từ bám CHỦ THỂ (`user_id`), CỐ Ý không `OR actor_user_id = :actor`. `Own` nghĩa là "sự kiện
   * VỀ tôi"; nới thêm vế actor cho một vai `Own` liệt kê được mọi người mình từng tác động, tức tập
   * hàng thành hàm của LỊCH SỬ HÀNH VI chứ không của scope — không luật nào kiểm được nó. Chiều còn
   * lại (chủ thể = tôi, actor = người khác) VẪN hiện, và đúng: đó là sự kiện về tôi; danh tính của
   * actor ở hàng đó vẫn bị che riêng bởi `identityActor`.
   */
  private buildWhere(rowScope: IdentityGrant, filter: SecurityEventFilter): SQL {
    const conds: SQL[] = [rowScopeSql(rowScope, userSecurityEvents.userId)];
    if (filter.userId) conds.push(eq(userSecurityEvents.userId, filter.userId));
    if (filter.eventType) conds.push(eq(userSecurityEvents.eventType, filter.eventType));
    if (filter.severity) conds.push(eq(userSecurityEvents.severity, filter.severity));
    if (filter.dateFrom) conds.push(gte(userSecurityEvents.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(userSecurityEvents.createdAt, filter.dateTo));
    return and(...conds) ?? sql`false`;
  }

  /**
   * ORDER BY allowlist contract (sort∈{created_at,severity,event_type}); chống injection.
   *
   * ⚠️ Khoá phụ `id` bắt buộc: `severity` có 5 giá trị, `event_type` một nhúm — sắp theo một cột trên
   * 65+ hàng là thứ tự KHÔNG XÁC ĐỊNH, và với `OFFSET` thì hàng mất/lặp giữa các trang.
   */
  private orderBy(sort: SecurityEventSortField, order: AuthLogSortOrder): SQL[] {
    const dir = order === "asc" ? asc : desc;
    return [dir(SECURITY_EVENT_SORT_COLUMN[sort]), desc(userSecurityEvents.id)];
  }

  async findManyTx(
    tx: TenantTx,
    filter: SecurityEventFilter,
    page: SecurityEventPage,
    grants: SecurityEventGrants,
  ): Promise<SecurityEventRow[]> {
    const actor = SECURITY_EVENT_ACTOR;
    return tx
      .select({
        id: userSecurityEvents.id,
        eventType: userSecurityEvents.eventType,
        severity: userSecurityEvents.severity,
        ipAddress: userSecurityEvents.ipAddress,
        userAgent: userSecurityEvents.userAgent,
        createdAt: userSecurityEvents.createdAt,
        userId: userSecurityEvents.userId,
        ...identityColumns(grants.identitySubject, {
          userEmail: users.email,
          userFullName: users.fullName,
        }),
        actorUserId: userSecurityEvents.actorUserId,
        // ⚠️ NHÓM THỨ HAI, GRANT RIÊNG — không tái dùng `identitySubject` (plan-review vòng 1, B1).
        // `buildUserScopeCondition` dựng vị từ trên `users` gốc, tức nó chỉ nói về CHỦ THỂ sự kiện.
        // Dùng chung một vị từ cho cả hai vai thì hàng có chủ thể = tôi (scope Own) sẽ cho `true` và
        // **lộ email của NGƯỜI GÂY RA sự kiện** — một lỗ MỚI do chính bản vá đẻ ra; chiều ngược lại
        // (tôi là người gây ra, chủ thể là người khác) thì giấu mất email của chính tôi = hồi quy
        // đường ALLOW. Mỗi vai một vị từ, dựng bằng `buildUserScopeConditionOn` với cột của vai đó.
        ...identityColumns(
          grants.identityActor,
          { actorEmail: actor.email, actorFullName: actor.fullName },
          // Tên cờ RIÊNG: mặc định `identityInScope` sẽ ĐÈ cờ của nhóm chủ thể ở trên — hai nhóm dùng
          // chung một cờ nghĩa là nhóm chủ thể bị quyết định bởi vị từ của nhóm actor, im lặng.
          "actorIdentityInScope",
        ),
      })
      .from(userSecurityEvents)
      .leftJoin(users, eq(users.id, userSecurityEvents.userId))
      .leftJoin(actor, eq(actor.id, userSecurityEvents.actorUserId))
      .where(this.buildWhere(grants.rowScope, filter))
      .orderBy(...this.orderBy(page.sort, page.order))
      .limit(page.limit)
      .offset(page.offset);
  }

  /** `rowScope` BẮT BUỘC — bỏ nó thì `pagination.total` rò số hàng ngoài scope (xem login-log repo). */
  async countTx(
    tx: TenantTx,
    filter: SecurityEventFilter,
    grants: Pick<SecurityEventGrants, "rowScope">,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(userSecurityEvents)
      .where(this.buildWhere(grants.rowScope, filter));
    return row?.n ?? 0;
  }
}

import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SecurityEventSortField, AuthLogSortOrder } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { userSecurityEvents } from "../db/schema/auth-logs";
import { users } from "../db/schema/users";

/**
 * Bộ lọc security-event (mọi field optional). KHÔNG nhận company_id — withTenant + RLS ép Company-scope
 * (BẤT BIẾN #1). event_type tự do (PASSWORD_CHANGED/USER_LOCKED…) → eq exact theo chuỗi đã validate.
 */
export interface SecurityEventFilter {
  userId?: string;
  eventType?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  dateFrom?: Date;
  dateTo?: Date;
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
  userEmail: string | null;
  userFullName: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorFullName: string | null;
}

/**
 * SecurityEventRepository — đọc append-only `user_security_events`. `tx` từ withTenant (RLS sống). Chỉ
 * SELECT/COUNT (append-only BẤT BIẾN #2). KHÔNG select cột jsonb `payload` (có thể chứa secret → BẤT BIẾN
 * #3). 2 leftJoin users: subject (user_id) + actor (actor_user_id, alias tách bảng).
 */
@Injectable()
export class SecurityEventRepository {
  private buildWhere(filter: SecurityEventFilter): SQL | undefined {
    const conds: SQL[] = [];
    if (filter.userId) conds.push(eq(userSecurityEvents.userId, filter.userId));
    if (filter.eventType) conds.push(eq(userSecurityEvents.eventType, filter.eventType));
    if (filter.severity) conds.push(eq(userSecurityEvents.severity, filter.severity));
    if (filter.dateFrom) conds.push(gte(userSecurityEvents.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(userSecurityEvents.createdAt, filter.dateTo));
    return conds.length ? and(...conds) : undefined;
  }

  /** ORDER BY allowlist contract (sort∈{created_at,severity,event_type}); chống injection. */
  private orderBy(sort: SecurityEventSortField, order: AuthLogSortOrder): SQL {
    const dir = order === "asc" ? asc : desc;
    const col =
      sort === "severity"
        ? userSecurityEvents.severity
        : sort === "event_type"
          ? userSecurityEvents.eventType
          : userSecurityEvents.createdAt;
    return dir(col);
  }

  async findManyTx(
    tx: TenantTx,
    filter: SecurityEventFilter,
    sort: SecurityEventSortField,
    order: AuthLogSortOrder,
    limit: number,
    offset: number,
  ): Promise<SecurityEventRow[]> {
    const actor = alias(users, "sec_event_actor");
    return tx
      .select({
        id: userSecurityEvents.id,
        eventType: userSecurityEvents.eventType,
        severity: userSecurityEvents.severity,
        ipAddress: userSecurityEvents.ipAddress,
        userAgent: userSecurityEvents.userAgent,
        createdAt: userSecurityEvents.createdAt,
        userId: userSecurityEvents.userId,
        userEmail: users.email,
        userFullName: users.fullName,
        actorUserId: userSecurityEvents.actorUserId,
        actorEmail: actor.email,
        actorFullName: actor.fullName,
      })
      .from(userSecurityEvents)
      .leftJoin(users, eq(users.id, userSecurityEvents.userId))
      .leftJoin(actor, eq(actor.id, userSecurityEvents.actorUserId))
      .where(this.buildWhere(filter))
      .orderBy(this.orderBy(sort, order))
      .limit(limit)
      .offset(offset);
  }

  async countTx(tx: TenantTx, filter: SecurityEventFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(userSecurityEvents)
      .where(this.buildWhere(filter));
    return row?.n ?? 0;
  }
}

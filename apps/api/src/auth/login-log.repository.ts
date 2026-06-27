import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { LoginLogSortField, AuthLogSortOrder } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { loginLogs } from "../db/schema/auth-logs";
import { users } from "../db/schema/users";

/**
 * Bộ lọc login-log (mọi field optional). KHÔNG nhận company_id — đường đọc đi qua withTenant + RLS ép
 * Company-scope (BẤT BIẾN #1), repo KHÔNG tự khoanh tenant (giữ ranh giới ở tầng service).
 */
export interface LoginLogFilter {
  userId?: string;
  status?: "success" | "failed" | "blocked";
  dateFrom?: Date;
  dateTo?: Date;
}

/** 1 hàng login-log + ref user rút gọn (leftJoin users — user_id NULL khi fail UserNotFound). */
export interface LoginLogRow {
  id: string;
  loginStatus: string;
  ipAddress: string | null;
  userAgent: string | null;
  failureReason: string | null;
  createdAt: Date;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
}

/**
 * LoginLogRepository — đọc append-only `login_logs`. Mọi truy vấn nhận `tx` từ withTenant (RLS sống) —
 * KHÔNG tự mở context. Chỉ SELECT/COUNT (append-only BẤT BIẾN #2 — KHÔNG có path UPDATE/DELETE).
 * KHÔNG select cột jsonb `metadata` (có thể chứa token/secret → BẤT BIẾN #3: không phơi ra DTO).
 */
@Injectable()
export class LoginLogRepository {
  private buildWhere(filter: LoginLogFilter): SQL | undefined {
    const conds: SQL[] = [];
    if (filter.userId) conds.push(eq(loginLogs.userId, filter.userId));
    if (filter.status) conds.push(eq(loginLogs.loginStatus, filter.status));
    if (filter.dateFrom) conds.push(gte(loginLogs.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(loginLogs.createdAt, filter.dateTo));
    return conds.length ? and(...conds) : undefined;
  }

  /** ORDER BY từ allowlist contract (sort∈{created_at,status}); chống injection (param → cột cố định). */
  private orderBy(sort: LoginLogSortField, order: AuthLogSortOrder): SQL {
    const dir = order === "asc" ? asc : desc;
    const col = sort === "status" ? loginLogs.loginStatus : loginLogs.createdAt;
    return dir(col);
  }

  async findManyTx(
    tx: TenantTx,
    filter: LoginLogFilter,
    sort: LoginLogSortField,
    order: AuthLogSortOrder,
    limit: number,
    offset: number,
  ): Promise<LoginLogRow[]> {
    return tx
      .select({
        id: loginLogs.id,
        loginStatus: loginLogs.loginStatus,
        ipAddress: loginLogs.ipAddress,
        userAgent: loginLogs.userAgent,
        failureReason: loginLogs.failureReason,
        createdAt: loginLogs.createdAt,
        userId: loginLogs.userId,
        userEmail: users.email,
        userFullName: users.fullName,
      })
      .from(loginLogs)
      .leftJoin(users, eq(users.id, loginLogs.userId))
      .where(this.buildWhere(filter))
      .orderBy(this.orderBy(sort, order))
      .limit(limit)
      .offset(offset);
  }

  async countTx(tx: TenantTx, filter: LoginLogFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(loginLogs)
      .where(this.buildWhere(filter));
    return row?.n ?? 0;
  }
}

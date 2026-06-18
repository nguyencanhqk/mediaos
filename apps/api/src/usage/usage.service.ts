import { Injectable } from "@nestjs/common";
import { and, count, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { TenantUsageResponse, UsageQuery } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { auditLogs, employeeProfiles, orgUnits, tasks, users } from "../db/schema";

/**
 * CS-7 UsageService — tổng hợp tình hình sử dụng PER TENANT.
 *
 * Mọi query qua withTenant(companyId) → RLS ép company_id. Defense-in-depth: mọi WHERE cũng tường
 * minh eq(*.companyId, companyId). KHÔNG cross-tenant leak.
 *
 * loginCount: đếm audit_logs action='auth.login_success' trong khoảng (dateFrom/dateTo).
 * tasksCreated: đếm tasks.created_at trong khoảng, deleted_at IS NULL.
 * tasksCompleted: đếm tasks status='completed' trong khoảng (updated_at — thời điểm hoàn thành).
 * users: join users ← employee_profiles ← org_units để lấy phòng ban; sắp xếp last_login_at desc nulls last.
 */
@Injectable()
export class UsageService {
  constructor(private readonly db: DatabaseService) {}

  async getTenantUsage(companyId: string, query: UsageQuery): Promise<TenantUsageResponse> {
    return this.db.withTenant(companyId, async (tx) => {
      const [loginCount, activeUserCount, tasksCreated, tasksCompleted, userRows] =
        await Promise.all([
          this.countLogins(tx, companyId, query),
          this.countActiveUsers(tx, companyId),
          this.countTasksCreated(tx, companyId, query),
          this.countTasksCompleted(tx, companyId, query),
          this.listUsers(tx, companyId),
        ]);

      return {
        loginCount,
        activeUserCount,
        tasksCreated,
        tasksCompleted,
        users: userRows,
      };
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private buildDateRange(
    field: "created_at" | "updated_at",
    query: UsageQuery,
  ): SQL[] {
    const conds: SQL[] = [];
    if (query.dateFrom) {
      // Use raw sql to reference the correct column on whatever table is being queried
      if (field === "created_at") {
        conds.push(gte(auditLogs.createdAt, new Date(query.dateFrom)));
      }
      // tasks: handled per-call below
    }
    if (query.dateTo) {
      if (field === "created_at") {
        conds.push(lte(auditLogs.createdAt, new Date(query.dateTo)));
      }
    }
    return conds;
  }

  private async countLogins(
    tx: TenantTx,
    companyId: string,
    query: UsageQuery,
  ): Promise<number> {
    const conds: SQL[] = [
      eq(auditLogs.companyId, companyId),
      eq(auditLogs.action, "auth.login_success"),
    ];
    if (query.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(query.dateFrom)));
    if (query.dateTo) conds.push(lte(auditLogs.createdAt, new Date(query.dateTo)));

    const [{ value }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(...conds));
    return value;
  }

  private async countActiveUsers(tx: TenantTx, companyId: string): Promise<number> {
    const [{ value }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));
    return value;
  }

  private async countTasksCreated(
    tx: TenantTx,
    companyId: string,
    query: UsageQuery,
  ): Promise<number> {
    const conds: SQL[] = [eq(tasks.companyId, companyId), isNull(tasks.deletedAt)];
    if (query.dateFrom) conds.push(gte(tasks.createdAt, new Date(query.dateFrom)));
    if (query.dateTo) conds.push(lte(tasks.createdAt, new Date(query.dateTo)));

    const [{ value }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...conds));
    return value;
  }

  private async countTasksCompleted(
    tx: TenantTx,
    companyId: string,
    query: UsageQuery,
  ): Promise<number> {
    const conds: SQL[] = [
      eq(tasks.companyId, companyId),
      eq(tasks.status, "completed"),
      isNull(tasks.deletedAt),
    ];
    // Filter by updatedAt as proxy for completion time
    if (query.dateFrom) conds.push(gte(tasks.updatedAt, new Date(query.dateFrom)));
    if (query.dateTo) conds.push(lte(tasks.updatedAt, new Date(query.dateTo)));

    const [{ value }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...conds));
    return value;
  }

  private async listUsers(
    tx: TenantTx,
    companyId: string,
  ): Promise<TenantUsageResponse["users"]> {
    const rows = await tx
      .select({
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        lastLoginAt: users.lastLoginAt,
        departmentName: orgUnits.name,
      })
      .from(users)
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.userId, users.id),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, employeeProfiles.orgUnitId))
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(sql`last_login_at DESC NULLS LAST`);

    return rows.map((r) => ({
      userId: r.userId,
      fullName: r.fullName ?? null,
      email: r.email,
      departmentName: r.departmentName ?? null,
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    }));
  }
}

import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { dbOpsGrantApprovals, dbOpsGrants } from "../db/schema";

/** Hàng grant đầy đủ (GLOBAL no-RLS — operator-scoped). */
export type DbOpsGrantRow = typeof dbOpsGrants.$inferSelect;

export interface InsertGrantData {
  requesterUserId: string;
  targetTenantId: string | null;
  reason: string;
  requiredApprovals: number;
  expiresAt: Date;
}

/**
 * DbOpsGrantRepository — data-access cho db_ops_grants + db_ops_grant_approvals (GLOBAL no-RLS,
 * operator-scoped). MỌI helper nhận `tx` (chạy trong withTransaction của service) để grant + approval cùng
 * commit/rollback. KHÔNG company_id (target_tenant_id thay) ⇒ KHÔNG RLS — phân quyền ở service (operator
 * permission gate + SoD). target_tenant_id match dùng IS NOT DISTINCT FROM (null = all-tenant scope).
 */
@Injectable()
export class DbOpsGrantRepository {
  async insertGrantTx(tx: TenantTx, data: InsertGrantData): Promise<DbOpsGrantRow> {
    const [row] = await tx
      .insert(dbOpsGrants)
      .values({
        requesterUserId: data.requesterUserId,
        targetTenantId: data.targetTenantId,
        reason: data.reason,
        requiredApprovals: data.requiredApprovals,
        expiresAt: data.expiresAt,
      })
      .returning();
    return row;
  }

  /** Đọc 1 grant theo id, KHOÁ hàng (FOR UPDATE) để serialize approve/revoke. */
  async findGrantByIdForUpdateTx(tx: TenantTx, grantId: string): Promise<DbOpsGrantRow | null> {
    const [row] = await tx
      .select()
      .from(dbOpsGrants)
      .where(eq(dbOpsGrants.id, grantId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Đọc lại grant (KHÔNG khoá) — dựng DTO sau mutate trong cùng tx. */
  async findGrantByIdTx(tx: TenantTx, grantId: string): Promise<DbOpsGrantRow | null> {
    const [row] = await tx
      .select()
      .from(dbOpsGrants)
      .where(eq(dbOpsGrants.id, grantId))
      .limit(1);
    return row ?? null;
  }

  /**
   * 🔒 Gate data-browser/export: đọc 1 grant 'active' CÒN HẠN của CHÍNH operator cho target (hoặc
   * all-tenant grant target IS NULL). `expires_at > now()` chạy trong tx ⇒ đồng hồ DB là nguồn sự thật
   * (hết hạn ép Ở DB). null = không có grant hợp lệ → caller fail-closed deny.
   *
   * Quy tắc phạm vi: 1 grant target=X authorize đọc tenant X. 1 grant target IS NULL (all-tenant) authorize
   * đọc MỌI tenant (kèm migration-status/export all). Truy vấn: (target = X) OR (target IS NULL).
   */
  async findActiveGrantForTargetTx(
    tx: TenantTx,
    requesterUserId: string,
    targetTenantId: string,
  ): Promise<DbOpsGrantRow | null> {
    const [row] = await tx
      .select()
      .from(dbOpsGrants)
      .where(
        and(
          eq(dbOpsGrants.requesterUserId, requesterUserId),
          eq(dbOpsGrants.status, "active"),
          sql`${dbOpsGrants.expiresAt} > now()`,
          sql`(${dbOpsGrants.targetTenantId} = ${targetTenantId} OR ${dbOpsGrants.targetTenantId} IS NULL)`,
        ),
      )
      .orderBy(sql`${dbOpsGrants.expiresAt} desc`)
      .limit(1);
    return row ?? null;
  }

  /** Gate all-tenant op (migration-status/export-all): grant 'active' còn hạn với target IS NULL. */
  async findActiveAllTenantGrantTx(
    tx: TenantTx,
    requesterUserId: string,
  ): Promise<DbOpsGrantRow | null> {
    const [row] = await tx
      .select()
      .from(dbOpsGrants)
      .where(
        and(
          eq(dbOpsGrants.requesterUserId, requesterUserId),
          eq(dbOpsGrants.status, "active"),
          sql`${dbOpsGrants.expiresAt} > now()`,
          isNull(dbOpsGrants.targetTenantId),
        ),
      )
      .orderBy(sql`${dbOpsGrants.expiresAt} desc`)
      .limit(1);
    return row ?? null;
  }

  /** INSERT 1 phiếu duyệt (APPEND-ONLY). Ném 23505 nếu duyệt-trùng (UNIQUE grant_id,approver). KHÔNG nuốt. */
  async insertApprovalTx(
    tx: TenantTx,
    grantId: string,
    approverUserId: string,
    requesterUserId: string,
  ): Promise<void> {
    await tx
      .insert(dbOpsGrantApprovals)
      .values({ grantId, approverUserId, requesterUserId });
  }

  /** Đếm số NGƯỜI duyệt KHÁC NHAU của 1 grant (COUNT DISTINCT approver). */
  async countDistinctApproversTx(tx: TenantTx, grantId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${dbOpsGrantApprovals.approverUserId})::int` })
      .from(dbOpsGrantApprovals)
      .where(eq(dbOpsGrantApprovals.grantId, grantId));
    return Number(row?.n ?? 0);
  }

  /** Flip 'pending' → 'active'. WHERE status='pending' ⇒ idempotent dưới đua. Trả số hàng đổi. */
  async activateGrantTx(tx: TenantTx, grantId: string): Promise<number> {
    const res = await tx
      .update(dbOpsGrants)
      .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(dbOpsGrants.id, grantId), eq(dbOpsGrants.status, "pending")));
    return res.rowCount ?? 0;
  }

  /** Thu hồi (pending/active → revoked). Guard status IN. Trả số hàng đổi. */
  async revokeGrantTx(tx: TenantTx, grantId: string, revokedBy: string): Promise<number> {
    const res = await tx
      .update(dbOpsGrants)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy, updatedAt: new Date() })
      .where(
        and(eq(dbOpsGrants.id, grantId), sql`${dbOpsGrants.status} in ('pending', 'active')`),
      );
    return res.rowCount ?? 0;
  }

  /** Liệt kê grant của CHÍNH operator (requester = operator) + approvalCount, mới nhất trước. */
  async listGrantsForRequesterTx(
    tx: TenantTx,
    requesterUserId: string,
  ): Promise<Array<DbOpsGrantRow & { approvalCount: number }>> {
    const rows = await tx
      .select({
        grant: dbOpsGrants,
        approvalCount: sql<number>`count(distinct ${dbOpsGrantApprovals.approverUserId})::int`,
      })
      .from(dbOpsGrants)
      .leftJoin(dbOpsGrantApprovals, eq(dbOpsGrantApprovals.grantId, dbOpsGrants.id))
      .where(eq(dbOpsGrants.requesterUserId, requesterUserId))
      .groupBy(dbOpsGrants.id)
      .orderBy(sql`${dbOpsGrants.createdAt} desc`);
    return rows.map((r) => ({ ...r.grant, approvalCount: Number(r.approvalCount ?? 0) }));
  }
}

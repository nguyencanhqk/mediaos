import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { breakGlassApprovals, breakGlassGrants, platformAccounts } from "../db/schema";

/** Hàng grant đầy đủ (đã lọc tenant qua RLS). */
export type BreakGlassGrantRow = typeof breakGlassGrants.$inferSelect;

export interface InsertGrantData {
  platformAccountId: string;
  requesterUserId: string;
  reason: string;
  requiredApprovals: number;
  expiresAt: Date;
}

/**
 * BreakGlassRepository (🔒 G6-2 PR-B) — data-access cho break_glass_grants + break_glass_approvals.
 * MỌI helper nhận `tx` (chạy trong `withTenant` của service) để grant + approval + audit cùng commit/
 * rollback (audit-in-tx). RLS lọc tenant ở DB — KHÔNG dựa kỷ luật dev (BẤT BIẾN #1).
 */
@Injectable()
export class BreakGlassRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Xác nhận platform_account tồn tại TRONG tenant (RLS-filtered) — chống trỏ account chéo tenant qua FK. */
  async platformAccountExistsTx(
    tx: TenantTx,
    companyId: string,
    accountId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: platformAccounts.id })
      .from(platformAccounts)
      .where(and(eq(platformAccounts.companyId, companyId), eq(platformAccounts.id, accountId)))
      .limit(1);
    return Boolean(row);
  }

  /** INSERT 1 grant 'pending'. company_id mặc định = current_setting (withTenant). Trả hàng vừa tạo. */
  async insertGrantTx(
    tx: TenantTx,
    companyId: string,
    data: InsertGrantData,
  ): Promise<BreakGlassGrantRow> {
    const [row] = await tx
      .insert(breakGlassGrants)
      .values({
        companyId,
        platformAccountId: data.platformAccountId,
        requesterUserId: data.requesterUserId,
        reason: data.reason,
        requiredApprovals: data.requiredApprovals,
        expiresAt: data.expiresAt,
      })
      .returning();
    return row;
  }

  /** Đọc grant theo id TRONG tenant, KHOÁ hàng (FOR UPDATE) để serialize approve/revoke. null nếu vắng/chéo-tenant. */
  async findGrantByIdForUpdateTx(
    tx: TenantTx,
    companyId: string,
    grantId: string,
  ): Promise<BreakGlassGrantRow | null> {
    const [row] = await tx
      .select()
      .from(breakGlassGrants)
      .where(and(eq(breakGlassGrants.companyId, companyId), eq(breakGlassGrants.id, grantId)))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Đọc lại grant (KHÔNG khoá) — dùng dựng DTO sau khi đã mutate trong cùng tx (thấy write của chính mình). */
  async findGrantByIdTx(
    tx: TenantTx,
    companyId: string,
    grantId: string,
  ): Promise<BreakGlassGrantRow | null> {
    const [row] = await tx
      .select()
      .from(breakGlassGrants)
      .where(and(eq(breakGlassGrants.companyId, companyId), eq(breakGlassGrants.id, grantId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * INSERT 1 phiếu duyệt (APPEND-ONLY). requester denormalized để DB CHECK self-approve ép được.
   * Ném lên nếu trùng (UNIQUE company_id,grant_id,approver) — caller dịch sang 409. KHÔNG nuốt.
   */
  async insertApprovalTx(
    tx: TenantTx,
    companyId: string,
    grantId: string,
    approverUserId: string,
    requesterUserId: string,
  ): Promise<void> {
    await tx.insert(breakGlassApprovals).values({
      companyId,
      grantId,
      approverUserId,
      requesterUserId,
    });
  }

  /** Đếm số NGƯỜI duyệt KHÁC NHAU của 1 grant (COUNT DISTINCT approver) — cơ sở flip 'active' theo ngưỡng SoD. */
  async countDistinctApproversTx(
    tx: TenantTx,
    companyId: string,
    grantId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${breakGlassApprovals.approverUserId})::int` })
      .from(breakGlassApprovals)
      .where(
        and(eq(breakGlassApprovals.companyId, companyId), eq(breakGlassApprovals.grantId, grantId)),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * Flip 'pending' → 'active' (set activated_at). WHERE status='pending' đảm bảo idempotent dưới đua:
   * approver thứ 2 sau khi grant đã active sẽ khớp 0 hàng (no-op). Trả số hàng đổi.
   */
  async activateGrantTx(tx: TenantTx, companyId: string, grantId: string): Promise<number> {
    const res = await tx
      .update(breakGlassGrants)
      .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(breakGlassGrants.companyId, companyId),
          eq(breakGlassGrants.id, grantId),
          eq(breakGlassGrants.status, "pending"),
        ),
      );
    return res.rowCount ?? 0;
  }

  /**
   * Thu hồi grant (pending/active → revoked) — set revoked_at + revoked_by. Trả số hàng đổi.
   * Guard `status IN ('pending','active')`: hàng terminal ('revoked') KHỚP 0 → KHÔNG ghi đè vết thu hồi
   * (revoked_at/revoked_by bất biến sau khi đã revoked). Caller kiểm rowCount===0 để bắt trạng thái bất thường.
   */
  async revokeGrantTx(
    tx: TenantTx,
    companyId: string,
    grantId: string,
    revokedBy: string,
  ): Promise<number> {
    const res = await tx
      .update(breakGlassGrants)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy, updatedAt: new Date() })
      .where(
        and(
          eq(breakGlassGrants.companyId, companyId),
          eq(breakGlassGrants.id, grantId),
          sql`${breakGlassGrants.status} in ('pending', 'active')`,
        ),
      );
    return res.rowCount ?? 0;
  }
}

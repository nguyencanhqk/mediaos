import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { assetMaintenances, type AssetMaintenance } from "../db/schema/assets";
import type { PageInput } from "./assets.types";
import { toOffset } from "./assets.types";

/**
 * S11-ASSET-BE-1 — persistence `asset_maintenances` (DB-15 §6.4 — SỔ: SELECT/INSERT + UPDATE cấp cột
 * `status·closed_*·result_note·cost·next_due_date·updated_*`, KHÔNG DELETE). Chốt cuối "1 Open/tài sản" =
 * `uq_asset_maintenances_open` (23505 → ASSET-ERR-004).
 */
@Injectable()
export class AssetMaintenanceRepository {
  async findOpenByAssetTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
  ): Promise<AssetMaintenance | undefined> {
    const [row] = await tx
      .select()
      .from(assetMaintenances)
      .where(
        and(
          eq(assetMaintenances.companyId, companyId),
          eq(assetMaintenances.assetId, assetId),
          eq(assetMaintenances.status, "Open"),
        ),
      )
      .limit(1);
    return row;
  }

  /** Lượt theo id PHẢI thuộc tài sản trong path (ASSET-ERR-005 `maintenance-not-found`). */
  async findByIdForAssetTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    id: string,
  ): Promise<AssetMaintenance | undefined> {
    const [row] = await tx
      .select()
      .from(assetMaintenances)
      .where(
        and(
          eq(assetMaintenances.companyId, companyId),
          eq(assetMaintenances.assetId, assetId),
          eq(assetMaintenances.id, id),
        ),
      )
      .limit(1);
    return row;
  }

  async insertOpenTx(
    tx: TenantTx,
    companyId: string,
    v: { assetId: string; reason: string; vendor: string | null; openedBy: string },
  ): Promise<AssetMaintenance> {
    const [row] = await tx
      .insert(assetMaintenances)
      .values({
        companyId,
        assetId: v.assetId,
        reason: v.reason,
        vendor: v.vendor,
        openedBy: v.openedBy,
        status: "Open",
        updatedBy: v.openedBy,
      })
      .returning();
    if (!row) throw new Error("insertOpenTx: INSERT asset_maintenances trả về 0 row");
    return row;
  }

  /** MỘT câu UPDATE đủ cột `chk_asset_maintenances_close_pair`; `WHERE status='Open'` ⇒ 0 hàng = đã đóng. */
  async closeTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    v: {
      resultNote: string | null;
      cost: string | null;
      nextDueDate: string | null;
      userId: string;
    },
  ): Promise<AssetMaintenance | undefined> {
    const [row] = await tx
      .update(assetMaintenances)
      .set({
        status: "Closed",
        closedAt: sql`now()`,
        closedBy: v.userId,
        resultNote: v.resultNote,
        cost: v.cost,
        nextDueDate: v.nextDueDate,
        updatedAt: sql`now()`,
        updatedBy: v.userId,
      })
      .where(
        and(
          eq(assetMaintenances.companyId, companyId),
          eq(assetMaintenances.id, id),
          eq(assetMaintenances.status, "Open"),
        ),
      )
      .returning();
    return row;
  }

  /** Tự đóng lượt Open của tài sản khi dispose/Lost (SPEC-13 §13.1) — 0 hàng là bình thường (không có lượt). */
  async closeOpenByAssetTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    v: { resultNote: string; userId: string },
  ): Promise<AssetMaintenance | undefined> {
    const [row] = await tx
      .update(assetMaintenances)
      .set({
        status: "Closed",
        closedAt: sql`now()`,
        closedBy: v.userId,
        resultNote: v.resultNote,
        updatedAt: sql`now()`,
        updatedBy: v.userId,
      })
      .where(
        and(
          eq(assetMaintenances.companyId, companyId),
          eq(assetMaintenances.assetId, assetId),
          eq(assetMaintenances.status, "Open"),
        ),
      )
      .returning();
    return row;
  }

  async listByAssetTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
    page: PageInput,
  ): Promise<{ rows: AssetMaintenance[]; total: number }> {
    const conds = [
      eq(assetMaintenances.companyId, companyId),
      eq(assetMaintenances.assetId, assetId),
    ];
    const rows = await tx
      .select()
      .from(assetMaintenances)
      .where(and(...conds))
      .orderBy(desc(assetMaintenances.openedAt), desc(assetMaintenances.id))
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetMaintenances)
      .where(and(...conds));
    return { rows, total: cnt?.n ?? 0 };
  }

  async countByAssetTx(tx: TenantTx, companyId: string, assetId: string): Promise<number> {
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetMaintenances)
      .where(
        and(eq(assetMaintenances.companyId, companyId), eq(assetMaintenances.assetId, assetId)),
      );
    return cnt?.n ?? 0;
  }
}

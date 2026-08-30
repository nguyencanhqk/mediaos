import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { assetCategories, assets, type AssetCategory } from "../db/schema/assets";

export interface AssetCategoryInsertValues {
  code: string;
  name: string;
  codePrefix: string;
  description: string | null;
  defaultMaintenanceIntervalDays: number | null;
  sortOrder: number;
  createdBy: string;
}

/** `undefined` = không đổi; `null` = xoá giá trị. */
export interface AssetCategoryPatchValues {
  name?: string;
  codePrefix?: string;
  description?: string | null;
  defaultMaintenanceIntervalDays?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  updatedBy: string;
}

/**
 * S11-ASSET-BE-1 — persistence `asset_categories` (DB-15 §6.1). Drizzle TYPED (schema/assets.ts parity 0549).
 *
 * BẤT BIẾN #1: mọi method chạy TRONG tx `withTenant` (RLS+FORCE) + WHERE AND `company_id` tường minh.
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDeleteTx` chỉ UPDATE `deleted_at/deleted_by`; `restoreTx` đảo lại
 * (đường DUY NHẤT để dùng lại `code_prefix` — DB-15 §6.7).
 */
@Injectable()
export class AssetCategoriesRepository {
  async listTx(
    tx: TenantTx,
    companyId: string,
    opts: { includeInactive: boolean; includeDeleted: boolean },
  ): Promise<AssetCategory[]> {
    const conds = [eq(assetCategories.companyId, companyId)];
    if (!opts.includeDeleted) conds.push(isNull(assetCategories.deletedAt));
    if (!opts.includeInactive) conds.push(eq(assetCategories.isActive, true));
    return tx
      .select()
      .from(assetCategories)
      .where(and(...conds))
      .orderBy(asc(assetCategories.sortOrder), asc(assetCategories.code));
  }

  /** `includeDeleted=true` CHỈ cho PATCH `restore` (API-14 003) — mọi đường khác lọc `deleted_at IS NULL`. */
  async findByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<AssetCategory | undefined> {
    const conds = [eq(assetCategories.id, id), eq(assetCategories.companyId, companyId)];
    if (!opts.includeDeleted) conds.push(isNull(assetCategories.deletedAt));
    const [row] = await tx
      .select()
      .from(assetCategories)
      .where(and(...conds))
      .limit(1);
    return row;
  }

  /** Loại ĐANG SỐNG cùng `code` (uq partial `deleted_at IS NULL`). */
  async findLiveByCodeTx(
    tx: TenantTx,
    companyId: string,
    code: string,
  ): Promise<AssetCategory | undefined> {
    const [row] = await tx
      .select()
      .from(assetCategories)
      .where(
        and(
          eq(assetCategories.companyId, companyId),
          eq(assetCategories.code, code),
          isNull(assetCategories.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Loại BẤT KỲ (kể cả đã xoá mềm) đang chiếm `code_prefix` — unique KHÔNG partial (0549). */
  async findByPrefixTx(
    tx: TenantTx,
    companyId: string,
    codePrefix: string,
  ): Promise<AssetCategory | undefined> {
    const [row] = await tx
      .select()
      .from(assetCategories)
      .where(
        and(eq(assetCategories.companyId, companyId), eq(assetCategories.codePrefix, codePrefix)),
      )
      .limit(1);
    return row;
  }

  async insertTx(
    tx: TenantTx,
    companyId: string,
    v: AssetCategoryInsertValues,
  ): Promise<AssetCategory> {
    const [row] = await tx
      .insert(assetCategories)
      .values({
        companyId,
        code: v.code,
        name: v.name,
        codePrefix: v.codePrefix,
        description: v.description,
        defaultMaintenanceIntervalDays: v.defaultMaintenanceIntervalDays,
        sortOrder: v.sortOrder,
        createdBy: v.createdBy,
        updatedBy: v.createdBy,
      })
      .returning();
    if (!row) throw new Error("insertTx: INSERT asset_categories trả về 0 row");
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: AssetCategoryPatchValues,
    opts: { restore?: boolean } = {},
  ): Promise<AssetCategory | undefined> {
    const set: Partial<typeof assetCategories.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: patch.updatedBy,
    };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.codePrefix !== undefined) set.codePrefix = patch.codePrefix;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.defaultMaintenanceIntervalDays !== undefined) {
      set.defaultMaintenanceIntervalDays = patch.defaultMaintenanceIntervalDays;
    }
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (opts.restore) {
      set.deletedAt = null;
      set.deletedBy = null;
    }
    const conds = [eq(assetCategories.id, id), eq(assetCategories.companyId, companyId)];
    if (!opts.restore) conds.push(isNull(assetCategories.deletedAt));
    const [row] = await tx
      .update(assetCategories)
      .set(set)
      .where(and(...conds))
      .returning();
    return row;
  }

  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    userId: string,
  ): Promise<AssetCategory | undefined> {
    const [row] = await tx
      .update(assetCategories)
      .set({
        deletedAt: sql`now()`,
        deletedBy: userId,
        updatedAt: sql`now()`,
        updatedBy: userId,
      })
      .where(
        and(
          eq(assetCategories.id, id),
          eq(assetCategories.companyId, companyId),
          isNull(assetCategories.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Số tài sản thuộc loại. `liveOnly=true` = chưa xoá mềm VÀ chưa `Disposed`/`Lost` (vế "còn tài sản" của
   * ASSET-ERR-010 `has-assets`); `false` = MỌI hàng kể cả đã xoá (vế "đã sinh mã" của `prefix-locked`).
   */
  async countAssetsTx(
    tx: TenantTx,
    companyId: string,
    categoryId: string,
    opts: { liveOnly: boolean },
  ): Promise<number> {
    const conds = [eq(assets.companyId, companyId), eq(assets.categoryId, categoryId)];
    if (opts.liveOnly) {
      conds.push(isNull(assets.deletedAt));
      conds.push(sql`${assets.status} not in ('Disposed', 'Lost')`);
    }
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(...conds));
    // GUARD (ASSET-ERR-010 has-assets / prefix-locked) — fail-CLOSED: 0 hàng là lỗi thật (gate MEDIUM).
    if (!row) throw new Error("countAssetsTx: câu đếm trả 0 row");
    return row.n;
  }
}

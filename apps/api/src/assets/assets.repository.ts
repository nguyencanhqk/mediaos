import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { assetAssignments, assetCategories, assets, type Asset } from "../db/schema/assets";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { fromScope, identityColumns } from "../permission/identity-projection";
import type { AssetActorScope, PageInput } from "./assets.types";
import { toOffset } from "./assets.types";

/** Cột người ĐANG giữ (lượt Active) — `holderFullName` đi qua `identityColumns` (L1), cờ `holderVisible` quyết định mapper. */
export interface AssetHolderCols {
  holderVisible: boolean;
  holderFullName: string | null;
  holderEmployeeId: string | null;
  holderEmployeeCode: string | null;
  holderAssignedAt: Date | null;
}

export type AssetWithHolderRow = Asset & {
  categoryCode: string;
  categoryName: string;
} & AssetHolderCols;

export interface AssetListFilter {
  categoryId?: string;
  status?: string[];
  /** ĐÃ qua kiểm scope ở service (review B9) — repository chỉ áp vị từ. */
  holderEmployeeId?: string;
  q?: string;
  maintenanceDueBefore?: string;
  sortBy: "assetCode" | "createdAt";
  sortDir: "asc" | "desc";
}

export interface AssetInsertValues {
  categoryId: string;
  assetCode: string;
  name: string;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  purchaseDate: string | null;
  purchasePrice: string | null;
  supplier: string | null;
  warrantyEndDate: string | null;
  location: string | null;
  description: string | null;
  createdBy: string;
}

export interface AssetPatchValues {
  categoryId?: string;
  name?: string;
  serialNumber?: string | null;
  brand?: string | null;
  model?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: string | null;
  supplier?: string | null;
  warrantyEndDate?: string | null;
  location?: string | null;
  description?: string | null;
  updatedBy: string;
}

/** Một câu UPDATE đổi trạng thái — `status` có thể là biểu thức SQL (`CASE …`, review B5/B6). */
export interface AssetTransitionValues {
  status: string | SQL;
  statusReason?: string | null;
  conditionNote?: string | null | SQL;
  nextMaintenanceDue?: string | null;
  userId: string;
}

export interface AssetSummaryRows {
  byStatus: Array<{ status: string; n: number }>;
  byCategory: Array<{
    categoryId: string;
    code: string;
    name: string;
    total: number;
    assigned: number;
  }>;
  maintenanceDueSoon: number;
}

const DUE_SOON_DAYS = 7;

/**
 * S11-ASSET-BE-1 — persistence `assets` (DB-15 §6.2). Drizzle TYPED, bảng `assets` KHÔNG alias vì vị từ scope
 * (`AssetAccessService.buildReadScopeExists`) tương quan qua định danh chữ `assets.id`.
 *
 * BẤT BIẾN #1: mọi method trong tx `withTenant` + WHERE AND `company_id`. BẤT BIẾN #2: soft-delete.
 *
 * ĐIỂM CHIẾU DANH TÍNH (KI-052/N-1c): `users.fullName` của người giữ hiện tại CHỈ đi ra qua
 * `identityColumns(grant, …)` với `grant = fromScope(actor.holderVisibleCond, "scoped-predicate", …, users.id)`.
 * Nhãn `grant.table = "users"` nói về CỘT được bọc (`users.full_name`); nhánh Department của vị từ dùng
 * `employee_profiles.org_unit_id` — `identityColumns` chỉ đối chiếu bảng của spec column nên hợp lệ (plan §4.3).
 * Mỗi hàm chiếu có 1 dòng ở `test/foundation/identity-projection-verdicts.ts`.
 */
@Injectable()
export class AssetsRepository {
  private holderGrant(actor: AssetActorScope) {
    return fromScope(
      actor.holderVisibleCond,
      "scoped-predicate",
      "S11-ASSET-BE-1 §13.6 — người giữ hiện tại chỉ hiện khi Own = chính caller / Department = trong đơn vị / Company.",
      users.id,
    );
  }

  private holderSelect(actor: AssetActorScope) {
    return {
      ...getTableColumns(assets),
      categoryCode: assetCategories.code,
      categoryName: assetCategories.name,
      holderEmployeeId: assetAssignments.employeeId,
      holderEmployeeCode: employeeProfiles.employeeCode,
      holderAssignedAt: assetAssignments.assignedAt,
      ...identityColumns(
        this.holderGrant(actor),
        { holderFullName: users.fullName },
        "holderVisible",
      ),
    };
  }

  private baseConds(companyId: string, actor?: AssetActorScope): SQL[] {
    const conds = [eq(assets.companyId, companyId), isNull(assets.deletedAt)];
    if (actor?.readScopeExists) conds.push(actor.readScopeExists);
    return conds;
  }

  private filterConds(companyId: string, filter: AssetListFilter): SQL[] {
    const conds: SQL[] = [];
    if (filter.categoryId) conds.push(eq(assets.categoryId, filter.categoryId));
    if (filter.status && filter.status.length > 0)
      conds.push(inArray(assets.status, filter.status));
    if (filter.maintenanceDueBefore) {
      // Vị từ VERBATIM của idx_assets_company_maintenance_due để planner dùng được index (gate MEDIUM-2).
      conds.push(lte(assets.nextMaintenanceDue, filter.maintenanceDueBefore));
      conds.push(sql`${assets.nextMaintenanceDue} is not null`);
      conds.push(sql`${assets.status} not in ('Disposed', 'Lost')`);
    }
    if (filter.q) {
      const like = `%${filter.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conds.push(
        or(
          ilike(assets.assetCode, like),
          ilike(assets.name, like),
          ilike(assets.serialNumber, like),
        )!,
      );
    }
    if (filter.holderEmployeeId) {
      conds.push(sql`exists (
        select 1 from asset_assignments aa
         where aa.company_id = ${companyId} and aa.asset_id = assets.id
           and aa.status = 'Active' and aa.employee_id = ${filter.holderEmployeeId}
      )`);
    }
    return conds;
  }

  /** Chi tiết + người giữ (007). Vị từ scope đi THẲNG vào WHERE ⇒ 0 hàng = cross-tenant HOẶC ngoài scope (404). */
  async findDetailTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actor: AssetActorScope,
  ): Promise<AssetWithHolderRow | undefined> {
    const [row] = await tx
      .select(this.holderSelect(actor))
      .from(assets)
      .innerJoin(
        assetCategories,
        and(eq(assetCategories.id, assets.categoryId), eq(assetCategories.companyId, companyId)),
      )
      .leftJoin(
        assetAssignments,
        and(
          eq(assetAssignments.assetId, assets.id),
          eq(assetAssignments.companyId, companyId),
          eq(assetAssignments.status, "Active"),
        ),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, assetAssignments.employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .leftJoin(users, and(eq(users.id, employeeProfiles.userId), eq(users.companyId, companyId)))
      .where(and(eq(assets.id, id), ...this.baseConds(companyId, actor)))
      .limit(1);
    return row as AssetWithHolderRow | undefined;
  }

  /** Danh sách (005) + người giữ — cùng grant/cờ với chi tiết. */
  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: AssetListFilter,
    page: PageInput,
    actor: AssetActorScope,
  ): Promise<{ rows: AssetWithHolderRow[]; total: number }> {
    const conds = [...this.baseConds(companyId, actor), ...this.filterConds(companyId, filter)];
    const sortCol = filter.sortBy === "createdAt" ? assets.createdAt : assets.assetCode;
    const order = filter.sortDir === "desc" ? desc(sortCol) : asc(sortCol);
    const rows = await tx
      .select(this.holderSelect(actor))
      .from(assets)
      .innerJoin(
        assetCategories,
        and(eq(assetCategories.id, assets.categoryId), eq(assetCategories.companyId, companyId)),
      )
      .leftJoin(
        assetAssignments,
        and(
          eq(assetAssignments.assetId, assets.id),
          eq(assetAssignments.companyId, companyId),
          eq(assetAssignments.status, "Active"),
        ),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, assetAssignments.employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .leftJoin(users, and(eq(users.id, employeeProfiles.userId), eq(users.companyId, companyId)))
      .where(and(...conds))
      .orderBy(order, asc(assets.id))
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(...conds));
    return { rows: rows as AssetWithHolderRow[], total: cnt?.n ?? 0 };
  }

  /** Thống kê (024) trong scope. */
  async summaryTx(
    tx: TenantTx,
    companyId: string,
    categoryId: string | undefined,
    actor: AssetActorScope,
  ): Promise<AssetSummaryRows> {
    const conds = this.baseConds(companyId, actor);
    if (categoryId) conds.push(eq(assets.categoryId, categoryId));
    const byStatus = await tx
      .select({ status: assets.status, n: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(...conds))
      .groupBy(assets.status);
    const byCategory = await tx
      .select({
        categoryId: assetCategories.id,
        code: assetCategories.code,
        name: assetCategories.name,
        total: sql<number>`count(*)::int`,
        assigned: sql<number>`count(*) filter (where ${assets.status} = 'Assigned')::int`,
      })
      .from(assets)
      .innerJoin(
        assetCategories,
        and(eq(assetCategories.id, assets.categoryId), eq(assetCategories.companyId, companyId)),
      )
      .where(and(...conds))
      .groupBy(assetCategories.id, assetCategories.code, assetCategories.name)
      .orderBy(asc(assetCategories.code));
    const [due] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(
        and(
          ...conds,
          sql`${assets.nextMaintenanceDue} is not null`,
          sql`${assets.nextMaintenanceDue} <= (current_date + ${DUE_SOON_DAYS}::int)`,
          sql`${assets.status} not in ('Disposed', 'Lost')`,
        ),
      );
    return { byStatus, byCategory, maintenanceDueSoon: due?.n ?? 0 };
  }

  /** Hàng theo id CHỈ ràng company (đường GHI — Company scope), KHÔNG khoá. */
  async findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<Asset | undefined> {
    const [row] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.companyId, companyId), isNull(assets.deletedAt)))
      .limit(1);
    return row;
  }

  /**
   * `SELECT … FOR UPDATE` — khoá hàng tài sản cho MỌI mutation trạng thái (SPEC-13 §13.1): hai request đua
   * xếp hàng ở đây, request sau đọc status ĐÃ đổi ⇒ FSM trả 4xx đúng mã thay vì đua tới unique.
   */
  async lockByIdTx(tx: TenantTx, companyId: string, id: string): Promise<Asset | undefined> {
    const [row] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.companyId, companyId), isNull(assets.deletedAt)))
      .limit(1)
      .for("update");
    return row;
  }

  async insertTx(tx: TenantTx, companyId: string, v: AssetInsertValues): Promise<Asset> {
    const [row] = await tx
      .insert(assets)
      .values({
        companyId,
        categoryId: v.categoryId,
        assetCode: v.assetCode,
        name: v.name,
        serialNumber: v.serialNumber,
        brand: v.brand,
        model: v.model,
        purchaseDate: v.purchaseDate,
        purchasePrice: v.purchasePrice,
        supplier: v.supplier,
        warrantyEndDate: v.warrantyEndDate,
        location: v.location,
        description: v.description,
        status: "In Stock",
        createdBy: v.createdBy,
        updatedBy: v.createdBy,
      })
      .returning();
    if (!row) throw new Error("insertTx: INSERT assets trả về 0 row");
    return row;
  }

  /** PATCH mô tả (008) — KHÔNG BAO GIỜ chạm `asset_code`/`status` (GRANT UPDATE cấp bảng, app tự loại). */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: AssetPatchValues,
  ): Promise<Asset | undefined> {
    const set: Partial<typeof assets.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: patch.updatedBy,
    };
    const keys = [
      "categoryId",
      "name",
      "serialNumber",
      "brand",
      "model",
      "purchaseDate",
      "purchasePrice",
      "supplier",
      "warrantyEndDate",
      "location",
      "description",
    ] as const;
    for (const k of keys) {
      if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
    }
    const [row] = await tx
      .update(assets)
      .set(set)
      .where(and(eq(assets.id, id), eq(assets.companyId, companyId), isNull(assets.deletedAt)))
      .returning();
    return row;
  }

  /**
   * MỘT câu UPDATE đổi trạng thái với `WHERE status IN (from)` (SPEC-13 §13.1 / plan §3.4). `status` nhận
   * biểu thức SQL để đích tính TRONG SQL (đóng bảo trì: `CASE WHEN EXISTS(lượt Active) …`; thu hồi: CASE theo
   * status hiện tại). 0 hàng ⇒ caller phân biệt 404/409 qua hàng đã khoá.
   */
  async transitionTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fromStatuses: string[],
    v: AssetTransitionValues,
  ): Promise<Asset | undefined> {
    const set: Record<string, unknown> = {
      status: v.status,
      statusChangedAt: sql`now()`,
      statusChangedBy: v.userId,
      updatedAt: sql`now()`,
      updatedBy: v.userId,
    };
    if (v.statusReason !== undefined) set.statusReason = v.statusReason;
    if (v.conditionNote !== undefined) set.conditionNote = v.conditionNote;
    if (v.nextMaintenanceDue !== undefined) set.nextMaintenanceDue = v.nextMaintenanceDue;
    const [row] = await tx
      .update(assets)
      .set(set as Partial<typeof assets.$inferInsert>)
      .where(
        and(
          eq(assets.id, id),
          eq(assets.companyId, companyId),
          isNull(assets.deletedAt),
          inArray(assets.status, fromStatuses),
        ),
      )
      .returning();
    return row;
  }

  /** Xoá mềm (009) — chỉ khi `In Stock` (WHERE là chốt cuối; lịch sử kiểm ở service). */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    userId: string,
  ): Promise<Asset | undefined> {
    const [row] = await tx
      .update(assets)
      .set({ deletedAt: sql`now()`, deletedBy: userId, updatedAt: sql`now()`, updatedBy: userId })
      .where(
        and(
          eq(assets.id, id),
          eq(assets.companyId, companyId),
          isNull(assets.deletedAt),
          eq(assets.status, "In Stock"),
        ),
      )
      .returning();
    return row;
  }

  /** Số lượt cấp phát + bảo trì (MỌI hàng sổ) — vế "0 lịch sử" của ASSET-ERR-015. */
  async countHistoryTx(
    tx: TenantTx,
    companyId: string,
    assetId: string,
  ): Promise<{ assignments: number; maintenances: number }> {
    const res = await tx.execute(sql`
      select
        (select count(*)::int from asset_assignments a
          where a.company_id = ${companyId} and a.asset_id = ${assetId}) as "assignments",
        (select count(*)::int from asset_maintenances m
          where m.company_id = ${companyId} and m.asset_id = ${assetId}) as "maintenances"
    `);
    const row = (res.rows as unknown as Array<{ assignments: number; maintenances: number }>)[0];
    // GUARD (ASSET-ERR-015) — fail-CLOSED: 0 hàng là lỗi thật, không phải "0 lịch sử" (gate MEDIUM).
    if (!row) throw new Error("countHistoryTx: câu đếm trả 0 row");
    return { assignments: row.assignments, maintenances: row.maintenances };
  }
}

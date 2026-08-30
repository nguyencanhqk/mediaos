import { Injectable } from "@nestjs/common";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  assetInventories,
  assetInventoryItems,
  assets,
  type AssetInventory,
  type AssetInventoryItem,
} from "../db/schema/assets";
import type { PageInput } from "./assets.types";
import { toOffset } from "./assets.types";

export type AssetInventoryItemRow = AssetInventoryItem & { assetCode: string; assetName: string };

/**
 * S11-ASSET-BE-1 — persistence `asset_inventories` + `asset_inventory_items` (DB-15 §6.5/§6.6 — SỔ, UPDATE cấp
 * cột, KHÔNG DELETE). Chốt cuối "1 đợt Open/company" = `uq_asset_inventories_open` (23505 → ASSET-ERR-006).
 */
@Injectable()
export class AssetInventoryRepository {
  async listTx(
    tx: TenantTx,
    companyId: string,
    status: string | undefined,
    page: PageInput,
  ): Promise<{ rows: AssetInventory[]; total: number }> {
    const conds = [eq(assetInventories.companyId, companyId)];
    if (status) conds.push(eq(assetInventories.status, status));
    const rows = await tx
      .select()
      .from(assetInventories)
      .where(and(...conds))
      .orderBy(desc(assetInventories.openedAt), desc(assetInventories.id))
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetInventories)
      .where(and(...conds));
    return { rows, total: cnt?.n ?? 0 };
  }

  async findByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<AssetInventory | undefined> {
    const [row] = await tx
      .select()
      .from(assetInventories)
      .where(and(eq(assetInventories.companyId, companyId), eq(assetInventories.id, id)))
      .limit(1);
    return row;
  }

  /**
   * `SELECT … FOR UPDATE` hàng đợt — mark và close PHẢI cùng khoá (gate HIGH-1): EXISTS trong WHERE của mark
   * không khoá gì, close đếm 4 số từ snapshot không thấy mark chưa commit ⇒ tổng kết lệch mà
   * `chk_asset_inventories_close_pair` vẫn qua và không sửa lại được. Thứ tự khoá: asset_inventories → items.
   */
  async lockByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<AssetInventory | undefined> {
    const [row] = await tx
      .select()
      .from(assetInventories)
      .where(and(eq(assetInventories.companyId, companyId), eq(assetInventories.id, id)))
      .limit(1)
      .for("update");
    return row;
  }

  async insertTx(
    tx: TenantTx,
    companyId: string,
    v: { name: string; categoryId: string | null; note: string | null; openedBy: string },
  ): Promise<AssetInventory> {
    const [row] = await tx
      .insert(assetInventories)
      .values({
        companyId,
        name: v.name,
        categoryId: v.categoryId,
        note: v.note,
        openedBy: v.openedBy,
        status: "Open",
        updatedBy: v.openedBy,
      })
      .returning();
    if (!row) throw new Error("insertTx: INSERT asset_inventories trả về 0 row");
    return row;
  }

  /**
   * Ảnh chụp MỘT câu `INSERT … SELECT` (SPEC-13 §13.4): LỌC `status NOT IN ('Disposed','Lost')` — BẮT BUỘC,
   * khớp `chk_asset_inventory_items_expected`; `expected_holder_employee_id` = lượt Active (0/1 hàng nhờ
   * `uq_asset_assignments_active`). Mọi cột qualify `a.`/`aa.` tường minh.
   */
  async snapshotItemsTx(
    tx: TenantTx,
    companyId: string,
    inventoryId: string,
    categoryId: string | null,
  ): Promise<number> {
    const res = await tx.execute(sql`
      insert into asset_inventory_items
        (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id)
      select a.company_id, ${inventoryId}::uuid, a.id, a.status,
             (select aa.employee_id from asset_assignments aa
               where aa.company_id = a.company_id and aa.asset_id = a.id and aa.status = 'Active'
               limit 1)
        from assets a
       where a.company_id = ${companyId}
         and a.deleted_at is null
         and a.status not in ('Disposed', 'Lost')
         and (${categoryId}::uuid is null or a.category_id = ${categoryId}::uuid)
    `);
    return Number(res.rowCount ?? 0);
  }

  async listItemsTx(
    tx: TenantTx,
    companyId: string,
    inventoryId: string,
    result: string | undefined,
    page: PageInput,
  ): Promise<{ rows: AssetInventoryItemRow[]; total: number }> {
    const conds = [
      eq(assetInventoryItems.companyId, companyId),
      eq(assetInventoryItems.inventoryId, inventoryId),
    ];
    if (result) conds.push(eq(assetInventoryItems.result, result));
    const rows = await tx
      .select({
        ...getTableColumns(assetInventoryItems),
        assetCode: assets.assetCode,
        assetName: assets.name,
      })
      .from(assetInventoryItems)
      .innerJoin(
        assets,
        and(eq(assets.id, assetInventoryItems.assetId), eq(assets.companyId, companyId)),
      )
      .where(and(...conds))
      .orderBy(assets.assetCode)
      .limit(page.perPage)
      .offset(toOffset(page));
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assetInventoryItems)
      .where(and(...conds));
    return { rows, total: cnt?.n ?? 0 };
  }

  /**
   * Đánh dấu — MỘT câu UPDATE đủ `chk_asset_inventory_items_check_pair`, gate đợt Open ngay trong WHERE.
   * Trả danh sách id đã đổi; thiếu so với `itemIds` ⇒ service chẩn đoán (đợt Closed 409 / item lạ 404).
   */
  async markItemsTx(
    tx: TenantTx,
    companyId: string,
    inventoryId: string,
    itemIds: string[],
    v: { result: string; note: string | null; userId: string },
  ): Promise<string[]> {
    const rows = await tx
      .update(assetInventoryItems)
      .set({
        result: v.result,
        checkedAt: sql`now()`,
        checkedBy: v.userId,
        note: v.note,
        updatedAt: sql`now()`,
        updatedBy: v.userId,
      })
      .where(
        and(
          eq(assetInventoryItems.companyId, companyId),
          eq(assetInventoryItems.inventoryId, inventoryId),
          inArray(assetInventoryItems.id, itemIds),
          sql`exists (
            select 1 from asset_inventories i
             where i.company_id = ${companyId} and i.id = ${inventoryId} and i.status = 'Open'
          )`,
        ),
      )
      .returning({ id: assetInventoryItems.id });
    return rows.map((r) => r.id);
  }

  /**
   * Đóng đợt — MỘT câu UPDATE, 4 số tổng kết tính TRONG SQL (review WARN: GROUP BY rồi UPDATE hai round-trip để
   * mark xen giữa làm số cũ mà `chk_asset_inventories_close_pair` vẫn qua). `WHERE status='Open'` ⇒ 0 hàng = đã đóng.
   */
  async closeTx(
    tx: TenantTx,
    companyId: string,
    inventoryId: string,
    v: { note: string | null | undefined; userId: string },
  ): Promise<AssetInventory | undefined> {
    // Không `sql.raw` (gate LOW): `result` đi qua tham số bind như mọi giá trị khác.
    const countOf = (result: string | null) =>
      sql`(select count(*)::int from asset_inventory_items it
            where it.company_id = ${companyId} and it.inventory_id = ${inventoryId}
              and (${result}::text is null or it.result = ${result}::text))`;
    const set: Record<string, unknown> = {
      status: "Closed",
      closedAt: sql`now()`,
      closedBy: v.userId,
      totalItems: countOf(null),
      foundCount: countOf("Found"),
      missingCount: countOf("Missing"),
      notCheckedCount: countOf("Not Checked"),
      updatedAt: sql`now()`,
      updatedBy: v.userId,
    };
    if (v.note !== undefined) set.note = v.note;
    const [row] = await tx
      .update(assetInventories)
      .set(set as Partial<typeof assetInventories.$inferInsert>)
      .where(
        and(
          eq(assetInventories.companyId, companyId),
          eq(assetInventories.id, inventoryId),
          eq(assetInventories.status, "Open"),
        ),
      )
      .returning();
    return row;
  }
}

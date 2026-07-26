import { Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  taskTemplateItems,
  taskTemplates,
  type TaskTemplate,
  type TaskTemplateItem,
} from "../db/schema/task-templates";

/**
 * S5-GOAL-TPL-1 — persistence danh mục task template (DB-11 §6.3/§6.4, mig 0526). Drizzle TYPED
 * (`schema/task-templates.ts` parity 100% với migration).
 *
 * BẤT BIẾN #1: MỌI method chạy TRONG tx của `withTenant` (RLS+FORCE) và WHERE luôn AND `company_id`
 *   tường minh — defense-in-depth trên RLS. Đặc biệt quan trọng ở đây: `template_id` và `department_id`
 *   là FK ĐƠN CỘT **không ép cùng-tenant ở DB** (carry-forward finding gate S5-GOAL-DB-2), nên hàng
 *   phòng thủ DUY NHẤT chống "biết UUID lạ ⇒ ghi được" là vế company_id ở đây.
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDelete*` chỉ UPDATE deleted_at/deleted_by (app role KHÔNG có
 *   quyền DELETE trên 2 bảng này, mig 0526 ⇒ hard-delete sẽ 42501 chứ không âm thầm).
 */

export interface TaskTemplateListFilter {
  departmentId?: string;
  isActive?: boolean;
  /** Từ khoá theo tên (ILIKE, không phân biệt hoa/thường). */
  q?: string;
  limit: number;
  offset: number;
}

/** Header + tên phòng (join org_units) + số item còn sống — 1 câu, KHÔNG N+1. */
export interface TaskTemplateListRow {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean | string;
  itemCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface TaskTemplateItemInsertValues {
  templateId: string;
  title: string;
  description: string | null;
  defaultPriority: string | null;
  estimateHours: string | null;
  checklist: string[] | null;
  sortOrder: number;
  createdBy: string;
}

/** Patch item: `undefined` = không đổi; `null` = xoá giá trị. */
export interface TaskTemplateItemPatchValues {
  title?: string;
  description?: string | null;
  defaultPriority?: string | null;
  estimateHours?: string | null;
  checklist?: string[] | null;
  sortOrder?: number;
}

@Injectable()
export class TaskTemplatesRepository {
  // ── Header ───────────────────────────────────────────────────────────────────

  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: TaskTemplateListFilter,
    scopeCond?: SQL,
  ): Promise<TaskTemplateListRow[]> {
    const conds: SQL[] = [
      sql`t.company_id = ${companyId}`,
      sql`t.deleted_at is null`,
      ...(filter.departmentId ? [sql`t.department_id = ${filter.departmentId}`] : []),
      ...(filter.isActive !== undefined ? [sql`t.is_active = ${filter.isActive}`] : []),
      ...(filter.q ? [sql`t.name ilike ${`%${filter.q}%`}`] : []),
      ...(scopeCond ? [scopeCond] : []),
    ];
    const res = await tx.execute(sql`
      select t.id, t.name, t.description,
             t.department_id as "departmentId", ou.name as "departmentName",
             t.is_active as "isActive",
             (select count(*)::int from task_template_items i
               where i.company_id = t.company_id and i.template_id = t.id and i.deleted_at is null
             ) as "itemCount",
             t.created_at as "createdAt", t.updated_at as "updatedAt"
        from task_templates t
        left join org_units ou on ou.id = t.department_id and ou.company_id = t.company_id
       where ${sql.join(conds, sql` and `)}
       order by t.is_active desc, t.name asc
       limit ${filter.limit} offset ${filter.offset}
    `);
    return res.rows as unknown as TaskTemplateListRow[];
  }

  /** Hàng theo id CHỈ ràng company (KHÔNG scope) — để phân biệt 404 (chéo tenant) với 403 (in-tenant). */
  async findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<TaskTemplate | undefined> {
    const [row] = await tx
      .select()
      .from(taskTemplates)
      .where(
        and(
          eq(taskTemplates.id, id),
          eq(taskTemplates.companyId, companyId),
          isNull(taskTemplates.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Tên phòng của template (hiển thị) — undefined khi template dùng-chung hoặc phòng đã xoá cứng. */
  async findDepartmentNameTx(
    tx: TenantTx,
    companyId: string,
    departmentId: string,
  ): Promise<string | undefined> {
    const res = await tx.execute(sql`
      select name from org_units
       where id = ${departmentId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as { name: string }[])[0]?.name;
  }

  /** UNIQUE (company, name) partial-active (mig 0526) — kiểm TRƯỚC insert để trả 409 thay vì 500 raw. */
  async findByNameTx(
    tx: TenantTx,
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      select id from task_templates
       where company_id = ${companyId} and lower(name) = lower(${name}) and deleted_at is null
         ${excludeId ? sql`and id <> ${excludeId}` : sql``}
       limit 1
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async insertTx(
    tx: TenantTx,
    companyId: string,
    v: {
      name: string;
      description: string | null;
      departmentId: string | null;
      isActive: boolean;
      createdBy: string;
    },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(taskTemplates)
      .values({
        companyId,
        name: v.name,
        description: v.description,
        departmentId: v.departmentId,
        isActive: v.isActive,
        createdBy: v.createdBy,
        updatedBy: v.createdBy,
      })
      .returning({ id: taskTemplates.id });
    if (!row) throw new Error("insertTx(task_templates): insert returned no row");
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      departmentId?: string | null;
      isActive?: boolean;
    },
    updatedBy: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(taskTemplates)
      .set({ ...patch, updatedAt: new Date(), updatedBy })
      .where(
        and(
          eq(taskTemplates.id, id),
          eq(taskTemplates.companyId, companyId),
          isNull(taskTemplates.deletedAt),
        ),
      )
      .returning({ id: taskTemplates.id });
    return row;
  }

  /**
   * Xoá MỀM header + CASCADE MỀM xuống item (2 lệnh CÙNG tx, KHÔNG DB trigger — mirror
   * TaskChecklistsRepository). FK `template_id` là CASCADE cứng ở DB nhưng ta không hard-delete, nên
   * item phải được đánh dấu tay: bỏ bước này thì item vẫn "còn sống" và lọt vào mọi câu đếm.
   */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(taskTemplates)
      .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date(), updatedBy: deletedBy })
      .where(
        and(
          eq(taskTemplates.id, id),
          eq(taskTemplates.companyId, companyId),
          isNull(taskTemplates.deletedAt),
        ),
      )
      .returning({ id: taskTemplates.id });
    if (!row) return undefined;
    await tx
      .update(taskTemplateItems)
      .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date(), updatedBy: deletedBy })
      .where(
        and(
          eq(taskTemplateItems.templateId, id),
          eq(taskTemplateItems.companyId, companyId),
          isNull(taskTemplateItems.deletedAt),
        ),
      );
    return row;
  }

  // ── Items ────────────────────────────────────────────────────────────────────

  async listItemsTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
  ): Promise<TaskTemplateItem[]> {
    return tx
      .select()
      .from(taskTemplateItems)
      .where(
        and(
          eq(taskTemplateItems.companyId, companyId),
          eq(taskTemplateItems.templateId, templateId),
          isNull(taskTemplateItems.deletedAt),
        ),
      )
      .orderBy(asc(taskTemplateItems.sortOrder), asc(taskTemplateItems.title));
  }

  async findItemTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
    itemId: string,
  ): Promise<TaskTemplateItem | undefined> {
    const [row] = await tx
      .select()
      .from(taskTemplateItems)
      .where(
        and(
          eq(taskTemplateItems.id, itemId),
          eq(taskTemplateItems.templateId, templateId),
          eq(taskTemplateItems.companyId, companyId),
          isNull(taskTemplateItems.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async countItemsTx(tx: TenantTx, companyId: string, templateId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(taskTemplateItems)
      .where(
        and(
          eq(taskTemplateItems.companyId, companyId),
          eq(taskTemplateItems.templateId, templateId),
          isNull(taskTemplateItems.deletedAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** `sort_order` kế tiếp trong template (mirror nextChecklistOrderIndexTx) — client không phải tự đếm. */
  async nextSortOrderTx(tx: TenantTx, companyId: string, templateId: string): Promise<number> {
    const res = await tx.execute(sql`
      select coalesce(max(sort_order), -1) + 1 as n from task_template_items
       where company_id = ${companyId} and template_id = ${templateId} and deleted_at is null
    `);
    return Number((res.rows as unknown as { n: number }[])[0]?.n ?? 0);
  }

  async insertItemTx(
    tx: TenantTx,
    companyId: string,
    v: TaskTemplateItemInsertValues,
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(taskTemplateItems)
      .values({
        companyId,
        templateId: v.templateId,
        title: v.title,
        description: v.description,
        defaultPriority: v.defaultPriority,
        estimateHours: v.estimateHours,
        checklist: v.checklist,
        sortOrder: v.sortOrder,
        createdBy: v.createdBy,
        updatedBy: v.createdBy,
      })
      .returning({ id: taskTemplateItems.id });
    if (!row) throw new Error("insertItemTx(task_template_items): insert returned no row");
    return row;
  }

  async updateItemTx(
    tx: TenantTx,
    companyId: string,
    itemId: string,
    patch: TaskTemplateItemPatchValues,
    updatedBy: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(taskTemplateItems)
      .set({ ...patch, updatedAt: new Date(), updatedBy })
      .where(
        and(
          eq(taskTemplateItems.id, itemId),
          eq(taskTemplateItems.companyId, companyId),
          isNull(taskTemplateItems.deletedAt),
        ),
      )
      .returning({ id: taskTemplateItems.id });
    return row;
  }

  async softDeleteItemTx(
    tx: TenantTx,
    companyId: string,
    itemId: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(taskTemplateItems)
      .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date(), updatedBy: deletedBy })
      .where(
        and(
          eq(taskTemplateItems.id, itemId),
          eq(taskTemplateItems.companyId, companyId),
          isNull(taskTemplateItems.deletedAt),
        ),
      )
      .returning({ id: taskTemplateItems.id });
    return row;
  }

  /** Tìm theo tên trong 1 template (chống thêm trùng tiêu đề khi seed từ FE) — chỉ cảnh báo, không chặn. */
  async findItemByTitleTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
    title: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: taskTemplateItems.id })
      .from(taskTemplateItems)
      .where(
        and(
          eq(taskTemplateItems.companyId, companyId),
          eq(taskTemplateItems.templateId, templateId),
          ilike(taskTemplateItems.title, title),
          isNull(taskTemplateItems.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }
}

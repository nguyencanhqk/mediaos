import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S4-TASK-BE-4 — persistence `task_checklists` + `task_checklist_items` (DB-06 §7.9/§7.10, mig 0478 §3/§4).
 * 2 bảng NÀY CHƯA typed trong Drizzle schema (chỉ dùng qua raw sql trong task-actions.repository.ts,
 * `countRequiredPendingItemsTx`) ⇒ raw `sql`` qua tx.execute (mirror task-core.repository.ts). company_id
 * BIND tường minh MỌI câu (BẤT BIẾN #1). Xoá = UPDATE deleted_at/deleted_by (BẤT BIẾN #2) — checklist xoá
 * CASCADE soft-delete xuống item của nó (service gọi 2 lệnh trong CÙNG tx, KHÔNG DB trigger).
 */

export interface TaskChecklistRow {
  id: string;
  taskId: string;
  title: string;
  description: string | null;
  isRequiredForDone: boolean | string;
  orderIndex: number;
  createdAt: string | Date;
  deletedAt: string | Date | null;
}

export interface TaskChecklistItemRow {
  id: string;
  checklistId: string;
  taskId: string;
  title: string;
  isDone: boolean | string;
  doneBy: string | null;
  doneAt: string | Date | null;
  orderIndex: number;
  deletedAt: string | Date | null;
}

const CHECKLIST_SELECT = sql`
  id, task_id AS "taskId", title, description, is_required_for_done AS "isRequiredForDone",
  order_index AS "orderIndex", created_at AS "createdAt", deleted_at AS "deletedAt"`;

const ITEM_SELECT = sql`
  id, checklist_id AS "checklistId", task_id AS "taskId", title, is_done AS "isDone",
  done_by AS "doneBy", done_at AS "doneAt", order_index AS "orderIndex", deleted_at AS "deletedAt"`;

@Injectable()
export class TaskChecklistsRepository {
  // ── Checklists ──────────────────────────────────────────────────────────────

  async listChecklistsTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
  ): Promise<TaskChecklistRow[]> {
    const res = await tx.execute(sql`
      select ${CHECKLIST_SELECT} from task_checklists
       where company_id = ${companyId} and task_id = ${taskId} and deleted_at is null
       order by order_index asc, created_at asc
    `);
    return res.rows as unknown as TaskChecklistRow[];
  }

  async findChecklistTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    checklistId: string,
  ): Promise<TaskChecklistRow | undefined> {
    const res = await tx.execute(sql`
      select ${CHECKLIST_SELECT} from task_checklists
       where company_id = ${companyId} and task_id = ${taskId} and id = ${checklistId}
       limit 1
    `);
    return (res.rows as unknown as TaskChecklistRow[])[0];
  }

  async nextChecklistOrderIndexTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
  ): Promise<number> {
    const res = await tx.execute(sql`
      select coalesce(max(order_index), -1) + 1 as n from task_checklists
       where company_id = ${companyId} and task_id = ${taskId} and deleted_at is null
    `);
    return (res.rows as unknown as { n: number }[])[0]?.n ?? 0;
  }

  async insertChecklistTx(
    tx: TenantTx,
    companyId: string,
    v: {
      taskId: string;
      title: string;
      isRequiredForDone: boolean;
      orderIndex: number;
      createdBy: string;
    },
  ): Promise<{ id: string }> {
    const res = await tx.execute(sql`
      insert into task_checklists (company_id, task_id, title, is_required_for_done, order_index, created_by, updated_by)
      values (${companyId}, ${v.taskId}, ${v.title}, ${v.isRequiredForDone}, ${v.orderIndex}, ${v.createdBy}, ${v.createdBy})
      returning id
    `);
    const row = (res.rows as unknown as { id: string }[])[0];
    if (!row) throw new Error("insertChecklistTx: insert returned no row");
    return row;
  }

  async updateChecklistTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
    patch: { title?: string; isRequiredForDone?: boolean; orderIndex?: number },
    updatedBy: string,
  ): Promise<{ id: string } | undefined> {
    const sets: SQL[] = [
      sql`updated_at = now()`,
      sql`updated_by = ${updatedBy}`,
    ];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.isRequiredForDone !== undefined) {
      sets.push(sql`is_required_for_done = ${patch.isRequiredForDone}`);
    }
    if (patch.orderIndex !== undefined) sets.push(sql`order_index = ${patch.orderIndex}`);
    const setClause = sql.join(sets, sql`, `);
    const res = await tx.execute(sql`
      update task_checklists set ${setClause}
       where id = ${checklistId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async softDeleteChecklistTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update task_checklists
         set deleted_at = now(), deleted_by = ${deletedBy}, updated_at = now(), updated_by = ${deletedBy}
       where id = ${checklistId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Cascade soft-delete mọi item CÒN SỐNG của 1 checklist (gọi CÙNG lúc với softDeleteChecklistTx). */
  async softDeleteItemsByChecklistTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
    deletedBy: string,
  ): Promise<void> {
    await tx.execute(sql`
      update task_checklist_items
         set deleted_at = now(), deleted_by = ${deletedBy}, updated_at = now(), updated_by = ${deletedBy}
       where company_id = ${companyId} and checklist_id = ${checklistId} and deleted_at is null
    `);
  }

  // ── Items ───────────────────────────────────────────────────────────────────

  async listItemsTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
  ): Promise<TaskChecklistItemRow[]> {
    const res = await tx.execute(sql`
      select ${ITEM_SELECT} from task_checklist_items
       where company_id = ${companyId} and checklist_id = ${checklistId} and deleted_at is null
       order by order_index asc, created_at asc
    `);
    return res.rows as unknown as TaskChecklistItemRow[];
  }

  async findItemTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
    itemId: string,
  ): Promise<TaskChecklistItemRow | undefined> {
    const res = await tx.execute(sql`
      select ${ITEM_SELECT} from task_checklist_items
       where company_id = ${companyId} and checklist_id = ${checklistId} and id = ${itemId}
       limit 1
    `);
    return (res.rows as unknown as TaskChecklistItemRow[])[0];
  }

  async nextItemOrderIndexTx(
    tx: TenantTx,
    companyId: string,
    checklistId: string,
  ): Promise<number> {
    const res = await tx.execute(sql`
      select coalesce(max(order_index), -1) + 1 as n from task_checklist_items
       where company_id = ${companyId} and checklist_id = ${checklistId} and deleted_at is null
    `);
    return (res.rows as unknown as { n: number }[])[0]?.n ?? 0;
  }

  async insertItemTx(
    tx: TenantTx,
    companyId: string,
    v: {
      taskId: string;
      checklistId: string;
      title: string;
      orderIndex: number;
      createdBy: string;
    },
  ): Promise<{ id: string }> {
    const res = await tx.execute(sql`
      insert into task_checklist_items (company_id, task_id, checklist_id, title, order_index, created_by, updated_by)
      values (${companyId}, ${v.taskId}, ${v.checklistId}, ${v.title}, ${v.orderIndex}, ${v.createdBy}, ${v.createdBy})
      returning id
    `);
    const row = (res.rows as unknown as { id: string }[])[0];
    if (!row) throw new Error("insertItemTx: insert returned no row");
    return row;
  }

  /**
   * Patch item. `isDone` khi CUNG CẤP: true ⇒ ghi done_by/done_by_employee_id/done_at=now(); false ⇒ clear cả
   * 3 (CHECK chk_task_checklist_items_done_consistency 0478 bắt buộc is_done/done_at đồng bộ).
   */
  async updateItemTx(
    tx: TenantTx,
    companyId: string,
    itemId: string,
    patch: { title?: string; orderIndex?: number; isDone?: boolean },
    actor: { userId: string; employeeId: string | null },
  ): Promise<{ id: string } | undefined> {
    const sets: SQL[] = [
      sql`updated_at = now()`,
      sql`updated_by = ${actor.userId}`,
    ];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.orderIndex !== undefined) sets.push(sql`order_index = ${patch.orderIndex}`);
    if (patch.isDone !== undefined) {
      if (patch.isDone) {
        sets.push(
          sql`is_done = true, done_by = ${actor.userId}, done_by_employee_id = ${actor.employeeId}, done_at = now()`,
        );
      } else {
        sets.push(sql`is_done = false, done_by = null, done_by_employee_id = null, done_at = null`);
      }
    }
    const setClause = sql.join(sets, sql`, `);
    const res = await tx.execute(sql`
      update task_checklist_items set ${setClause}
       where id = ${itemId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async softDeleteItemTx(
    tx: TenantTx,
    companyId: string,
    itemId: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update task_checklist_items
         set deleted_at = now(), deleted_by = ${deletedBy}, updated_at = now(), updated_by = ${deletedBy}
       where id = ${itemId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }
}

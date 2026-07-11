import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S4-TASK-BE-3 — persistence cho task actions (mutate vòng đời + assignee/watcher/checklist/leave).
 *
 * Cột 0478 (task_status · task_priority · due_at · main_assignee_employee_id · completed/cancelled) CHƯA typed
 * trong Drizzle schema (mirror task-core.repository) ⇒ raw `sql`` qua tx.execute. company_id BIND tường minh
 * MỌI câu (BẤT BIẾN #1 defense-in-depth trên RLS+FORCE). Chạy TRONG tx của withTenant (caller mở).
 *
 * BẤT BIẾN #2: assignee/watcher gỡ = SOFT-remove (status='Removed'+removed_at/by+deleted_at) — KHÔNG DELETE.
 */

/** Hàng THÔ đầy đủ cho action (guard workflow/tenant + FSM + side-effect + leave/warning). */
export interface ActionTaskRaw {
  id: string;
  taskType: string;
  workflowStepId: string | null;
  projectId: string | null;
  mainAssigneeEmployeeId: string | null;
  assigneeUserId: string | null;
  creatorUserId: string | null;
  taskStatus: string | null;
  taskPriority: string | null;
  taskCode: string | null;
  title: string;
  startAt: string | Date | null;
  dueAt: string | Date | null;
}

@Injectable()
export class TaskActionsRepository {
  /** Hàng thô đầy đủ (soft-deleted ⇒ undefined = 404). */
  async findActionRawTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<ActionTaskRaw | undefined> {
    const res = await tx.execute(sql`
      select id, task_type as "taskType", workflow_step_id as "workflowStepId",
             project_id as "projectId", main_assignee_employee_id as "mainAssigneeEmployeeId",
             assignee_user_id as "assigneeUserId", creator_user_id as "creatorUserId",
             task_status as "taskStatus", task_priority as "taskPriority", task_code as "taskCode",
             title, start_at as "startAt", due_at as "dueAt"
        from tasks
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as ActionTaskRaw[])[0];
  }

  // ── Mutations trên cột task_status/priority/due (raw — cột chưa typed) ─────────

  /** Đổi task_status + side-effect completed/cancelled (đã tính ở service). Trả {id} | undefined. */
  async updateStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    v: {
      status: string;
      completedAt: "now" | "clear" | "keep";
      cancelledAt: "now" | "clear" | "keep";
      actorUserId: string;
    },
  ): Promise<{ id: string } | undefined> {
    const completed =
      v.completedAt === "now"
        ? sql`, completed_at = now(), completed_by = ${v.actorUserId}`
        : v.completedAt === "clear"
          ? sql`, completed_at = null, completed_by = null`
          : sql``;
    const cancelled =
      v.cancelledAt === "now"
        ? sql`, cancelled_at = now(), cancelled_by = ${v.actorUserId}`
        : v.cancelledAt === "clear"
          ? sql`, cancelled_at = null, cancelled_by = null`
          : sql``;
    const res = await tx.execute(sql`
      update tasks
         set task_status = ${v.status}, updated_at = now(), updated_by = ${v.actorUserId}
             ${completed} ${cancelled}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async updatePriorityTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    priority: string,
    actorUserId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks set task_priority = ${priority}, updated_at = now(), updated_by = ${actorUserId}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async updateDueTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    dueAt: string | null,
    actorUserId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks set due_at = ${dueAt}, updated_at = now(), updated_by = ${actorUserId}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Set main_assignee_employee_id + assignee_user_id (legacy board) trên tasks. */
  async updateMainAssigneeTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    mainAssigneeEmployeeId: string,
    assigneeUserId: string,
    actorUserId: string,
  ): Promise<void> {
    await tx.execute(sql`
      update tasks
         set main_assignee_employee_id = ${mainAssigneeEmployeeId},
             assignee_user_id = ${assigneeUserId},
             updated_at = now(), updated_by = ${actorUserId}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
    `);
  }

  // ── task_assignees (swap-Main tolerant: soft-remove Main cũ nếu có, insert Main mới) ──

  /** Soft-remove MỌI hàng Main Active hiện tại của task (chuẩn bị insert Main mới). */
  async softRemoveMainAssigneesTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    removedBy: string,
  ): Promise<void> {
    await tx.execute(sql`
      update task_assignees
         set status = 'Removed', removed_at = now(), removed_by = ${removedBy},
             deleted_at = now(), deleted_by = ${removedBy}, updated_at = now(), updated_by = ${removedBy}
       where company_id = ${companyId} and task_id = ${taskId}
         and status = 'Active' and assignee_role = 'Main' and deleted_at is null
    `);
  }

  async insertMainAssigneeTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    employeeId: string,
    assignedBy: string,
  ): Promise<void> {
    await tx.execute(sql`
      insert into task_assignees (company_id, task_id, employee_id, assignee_role, status, assigned_by, created_by, updated_by)
      values (${companyId}, ${taskId}, ${employeeId}, 'Main', 'Active', ${assignedBy}, ${assignedBy}, ${assignedBy})
    `);
  }

  // ── task_watchers (self-only) ─────────────────────────────────────────────────

  /** Watcher Active/Muted hiện có của employee trên task (chống trùng). */
  async findActiveWatcherTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    employeeId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      select id from task_watchers
       where company_id = ${companyId} and task_id = ${taskId} and employee_id = ${employeeId}
         and status in ('Active','Muted') and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async insertWatcherTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    employeeId: string,
    addedBy: string,
  ): Promise<{ id: string }> {
    const res = await tx.execute(sql`
      insert into task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by, created_by, updated_by)
      values (${companyId}, ${taskId}, ${employeeId}, 'Manual', 'Active', ${addedBy}, ${addedBy}, ${addedBy})
      returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Watcher theo id + task (guard tenant/task). Bất kỳ status/soft-delete để phân biệt 404 vs đã gỡ. */
  async findWatcherByIdTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    watcherId: string,
  ): Promise<
    { id: string; employeeId: string; status: string; deletedAt: string | Date | null } | undefined
  > {
    const res = await tx.execute(sql`
      select id, employee_id as "employeeId", status, deleted_at as "deletedAt" from task_watchers
       where company_id = ${companyId} and task_id = ${taskId} and id = ${watcherId}
       limit 1
    `);
    return (
      res.rows as unknown as {
        id: string;
        employeeId: string;
        status: string;
        deletedAt: string | Date | null;
      }[]
    )[0];
  }

  async softRemoveWatcherTx(
    tx: TenantTx,
    companyId: string,
    watcherId: string,
    removedBy: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update task_watchers
         set status = 'Removed', removed_at = now(), removed_by = ${removedBy},
             deleted_at = now(), deleted_by = ${removedBy}, updated_at = now(), updated_by = ${removedBy}
       where company_id = ${companyId} and id = ${watcherId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  // ── Checklist-required pending (ĐK-3: CHỈ checklist is_required_for_done=true) ──

  async countRequiredPendingItemsTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
  ): Promise<number> {
    const res = await tx.execute(sql`
      select count(*)::int as n
        from task_checklist_items ci
        join task_checklists cl on cl.id = ci.checklist_id
       where ci.company_id = ${companyId} and ci.task_id = ${taskId}
         and ci.is_done = false and ci.deleted_at is null
         and cl.is_required_for_done = true and cl.deleted_at is null
    `);
    return (res.rows as unknown as { n: number }[])[0]?.n ?? 0;
  }

  // ── Leave overlap (cross-module READ; status union approved/Approved; OR user_id/employee_id) ──

  async hasApprovedLeaveOnDateTx(
    tx: TenantTx,
    companyId: string,
    dateIso: string,
    assigneeUserId: string | null,
    assigneeEmployeeId: string | null,
  ): Promise<boolean> {
    const subject =
      assigneeUserId && assigneeEmployeeId
        ? sql`(user_id = ${assigneeUserId} or employee_id = ${assigneeEmployeeId})`
        : assigneeUserId
          ? sql`user_id = ${assigneeUserId}`
          : sql`employee_id = ${assigneeEmployeeId}`;
    const res = await tx.execute(sql`
      select 1 from leave_requests
       where company_id = ${companyId}
         and status in ('approved','Approved')
         and deleted_at is null
         and start_date <= ${dateIso}::date and end_date >= ${dateIso}::date
         and ${subject}
       limit 1
    `);
    return res.rows.length > 0;
  }

  // ── Project membership (warning NOT-MEMBER) ───────────────────────────────────

  async isEmployeeProjectMemberTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    employeeId: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      select 1 from project_members
       where company_id = ${companyId} and project_id = ${projectId}
         and employee_id = ${employeeId} and member_status = 'Active' and deleted_at is null
       limit 1
    `);
    return res.rows.length > 0;
  }
}
